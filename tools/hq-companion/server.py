# -*- coding: utf-8 -*-
"""SpriteFlow 高质量拆件本地伴生服务。

让纯前端网站（localhost:5190）把整图交给本机 GPU 跑 see-through 扩散分层，
并产出 SpriteFlow 格式的保真导出（parts/ + parts-completed/ + parts.json + PSD）。

用 see-through 的 venv 运行（标准库 + venv 已装依赖，无新增依赖）：
  D:\\projects\\tools\\see-through\\.venv\\Scripts\\python.exe server.py

接口（全部带 CORS Access-Control-Allow-Origin: *，OPTIONS 预检 204）：
  GET  /health                     -> {ok, gpu, busy, version, queued}
  PUT  /jobs?name=x.png&quality=standard|draft   body=原始图片字节 -> {jobId}
  GET  /jobs/<id>                  -> {status, stage, quality, startedAt, etaMinutes, logTail}
  GET  /jobs/<id>/result           -> ZIP（application/zip）

同时刻只跑 1 个 GPU 任务，其余排队（内部 queue + 单 worker 线程）。
流程：inference_psd.py（layerdiff→depth→extract）→ splice.py（splice）→ 打包（pack）。
"""
import atexit
import json
import os
import os.path as osp
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
HERE = osp.dirname(osp.abspath(__file__))
PORT = int(os.environ.get("HQ_COMPANION_PORT", "8790"))
VERSION = "1.0.0"

SEE_THROUGH_DIR = r"D:\projects\tools\see-through"
INFERENCE_SCRIPT = osp.join(SEE_THROUGH_DIR, "inference", "scripts", "inference_psd.py")
SPLICE_SCRIPT = osp.join(HERE, "splice.py")
JOBS_DIR = osp.join(HERE, "jobs")

# 与 run-inference.bat 一致：HF 缓存放 D 盘
HF_ENV = {
    "HF_HOME": osp.join(SEE_THROUGH_DIR, "hf-cache"),
    "HF_HUB_CACHE": osp.join(SEE_THROUGH_DIR, "hf-cache", "huggingface", "hub"),
}

# 质量档位：inference_psd.py 参数 + 预计耗时（分钟，RTX 4060 Laptop 8GB + group_offload 实测估计）
QUALITY_PRESETS = {
    "standard": {
        "args": ["--resolution", "1024"],
        "etaMinutes": 80,  # 实测 1254px 图 @1024/30steps 约 78 分钟
    },
    "draft": {
        "args": ["--resolution", "512", "--inference_steps", "15", "--inference_steps_depth", "10"],
        "etaMinutes": 12,  # 快速验证档
    },
}

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MAX_BODY_BYTES = 64 * 1024 * 1024  # 64MB 上限

# ---------------------------------------------------------------------------
# 任务状态
# ---------------------------------------------------------------------------
STAGES = ["queued", "layerdiff", "depth", "extract", "splice", "pack"]


class Job:
    def __init__(self, job_id, quality, display_name):
        self.id = job_id
        self.quality = quality
        self.display_name = display_name
        self.dir = osp.join(JOBS_DIR, job_id)
        self.status = "queued"          # queued | running | done | error
        self.stage = "queued"
        self.error = None
        self.created_at = time.time()
        self.started_at = None
        self.finished_at = None
        self.log_lines = []
        self.lock = threading.Lock()

    def append_log(self, line):
        with self.lock:
            self.log_lines.append(line)
            if len(self.log_lines) > 200:
                del self.log_lines[:100]

    def log_tail(self, limit=3000):
        with self.lock:
            text = "\n".join(self.log_lines[-40:])
        return text[-limit:]

    def set_stage(self, stage):
        with self.lock:
            self.stage = stage

    def public_state(self):
        with self.lock:
            status, stage, error = self.status, self.stage, self.error
            started_at, created_at = self.started_at, self.created_at
        eta = None
        expected = QUALITY_PRESETS[self.quality]["etaMinutes"]
        if status == "running" and started_at is not None:
            eta = max(0.0, expected - (time.time() - started_at) / 60.0)
        elif status == "queued":
            eta = expected + (WORKER.remaining_minutes() or 0.0)
        return {
            "jobId": self.id,
            "status": status,
            "stage": stage,
            "quality": self.quality,
            "name": self.display_name,
            "createdAtIso": iso(created_at),
            "startedAtIso": iso(started_at) if started_at else None,
            "etaMinutes": round(eta, 1) if eta is not None else None,
            "error": error,
            "logTail": self.log_tail(),
        }


def iso(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone().isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# GPU 探测（nvidia-smi，可选能力，失败不影响 /health）
# ---------------------------------------------------------------------------
_gpu_cache = {"ts": 0.0, "value": None}
_gpu_lock = threading.Lock()


def probe_gpu():
    now = time.time()
    with _gpu_lock:
        if now - _gpu_cache["ts"] < 30:
            return _gpu_cache["value"]
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,memory.used,utilization.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5)
        if out.returncode == 0:
            parts = [p.strip() for p in out.stdout.strip().splitlines()[0].split(",")]
            value = {
                "name": parts[0],
                "memoryTotalMiB": int(float(parts[1])),
                "memoryUsedMiB": int(float(parts[2])),
                "utilizationPercent": int(float(parts[3])),
            }
        else:
            value = None
    except Exception:
        value = None
    with _gpu_lock:
        _gpu_cache["ts"], _gpu_cache["value"] = now, value
    return value


# ---------------------------------------------------------------------------
# 单 worker：同一时刻只跑 1 个 GPU 任务
# ---------------------------------------------------------------------------
class Worker(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True, name="hq-worker")
        self.queue = queue.Queue()
        self.jobs = {}                 # job_id -> Job
        self.jobs_lock = threading.Lock()
        self.current = None
        self.current_proc = None

    def submit(self, job):
        with self.jobs_lock:
            self.jobs[job.id] = job
        self.queue.put(job)

    def remaining_minutes(self):
        cur = self.current
        if cur is None or cur.started_at is None or cur.status != "running":
            return 0.0
        expected = QUALITY_PRESETS[cur.quality]["etaMinutes"]
        return max(0.0, expected - (time.time() - cur.started_at) / 60.0)

    def run(self):
        while True:
            job = self.queue.get()
            self.current = job
            try:
                self._run_job(job)
            except Exception as exc:  # noqa: BLE001 —— 任何异常都落到任务 error
                job.append_log("[companion] fatal: %r" % (exc,))
                with job.lock:
                    job.status, job.error = "error", repr(exc)
                    job.finished_at = time.time()
            finally:
                self.current = None
                self.current_proc = None

    # -- 子进程辅助：逐行喂日志，回调阶段切换 -------------------------------
    def _popen(self, cmd, cwd, job, on_line=None, env=None):
        proc = subprocess.Popen(
            cmd, cwd=cwd, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", bufsize=1)
        self.current_proc = proc
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                job.append_log(line)
                if on_line:
                    on_line(line)
        proc.wait()
        return proc.returncode

    def _run_job(self, job):
        with job.lock:
            job.status = "running"
            job.started_at = time.time()
            job.stage = "layerdiff"
        job.append_log("[companion] job %s quality=%s start" % (job.id, job.quality))

        preset = QUALITY_PRESETS[job.quality]
        src = osp.join(job.dir, "input.png")
        layerdiff_dir = osp.join(job.dir, "layerdiff")
        out_dir = osp.join(job.dir, "out")
        result_zip = osp.join(job.dir, "result.zip")

        env = dict(os.environ)
        env.update(HF_ENV)

        # 阶段 1：see-through 推理（layerdiff -> depth -> extract 都在这一个进程里）
        def on_line(line):
            low = line.lower()
            if "running marigold" in low:
                job.set_stage("depth")

        cmd = [sys.executable, INFERENCE_SCRIPT,
               "--srcp", src,
               "--save_dir", layerdiff_dir,
               "--save_to_psd", "--group_offload"] + preset["args"]
        job.append_log("[companion] run: %s" % " ".join(cmd[1:]))
        code = self._popen(cmd, SEE_THROUGH_DIR, job, on_line=on_line, env=env)
        if code != 0:
            with job.lock:
                job.status, job.error = "error", "inference_psd exit %s" % code
                job.finished_at = time.time()
            return
        job.set_stage("extract")
        # 推理输出：layerdiff/input/（input.png 的 stem 恒为 input）
        layers_dir = osp.join(layerdiff_dir, "input")
        psd_path = osp.join(layerdiff_dir, "input.psd")
        if not osp.isdir(layers_dir):
            with job.lock:
                job.status, job.error = "error", "layerdiff output missing: %s" % layers_dir
                job.finished_at = time.time()
            return

        # 阶段 2：保真拼接
        job.set_stage("splice")
        code = self._popen([sys.executable, SPLICE_SCRIPT,
                            "--src", src, "--layers", layers_dir,
                            "--psd", psd_path, "--out", out_dir],
                           SEE_THROUGH_DIR, job)
        if code != 0:
            with job.lock:
                job.status, job.error = "error", "splice exit %s" % code
                job.finished_at = time.time()
            return

        # 阶段 3：打包
        job.set_stage("pack")
        shutil.make_archive(result_zip[:-4], "zip", out_dir)
        job.append_log("[companion] packed %s (%d bytes)"
                       % (osp.basename(result_zip), osp.getsize(result_zip)))
        with job.lock:
            job.status = "done"
            job.stage = "pack"
            job.finished_at = time.time()
        job.append_log("[companion] job %s done in %.1f min"
                       % (job.id, (job.finished_at - job.started_at) / 60.0))


WORKER = Worker()


def kill_current_proc():
    proc = WORKER.current_proc
    if proc is not None and proc.poll() is None:
        proc.kill()


atexit.register(kill_current_proc)


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "hq-companion/" + VERSION
    protocol_version = "HTTP/1.1"

    # -- 工具 ---------------------------------------------------------------
    def _send(self, status, body, content_type="application/json; charset=utf-8"):
        data = body if isinstance(body, (bytes, bytearray)) else json.dumps(
            body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):  # 安静模式：错误仍打到 stderr
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _job_from_path(self, path_parts):
        if len(path_parts) != 2 or path_parts[0] != "jobs":
            return None
        with WORKER.jobs_lock:
            return WORKER.jobs.get(path_parts[1])

    # -- 路由 ---------------------------------------------------------------
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        parts = [p for p in parsed.path.split("/") if p]
        if parsed.path in ("/health", "/healthz") or parts == ["health"]:
            gpu = probe_gpu()
            counts = {"queued": 0, "running": 0, "done": 0, "error": 0}
            with WORKER.jobs_lock:
                for job in WORKER.jobs.values():
                    with job.lock:
                        counts[job.status] = counts.get(job.status, 0) + 1
            self._send(200, {
                "ok": True,
                "version": VERSION,
                "gpu": gpu,
                "busy": WORKER.current is not None,
                "jobs": counts,
            })
            return
        job = self._job_from_path(parts)
        if job is None:
            self._send(404, {"error": "job not found"})
            return
        if len(parts) == 2 and parts[0] == "jobs":
            self._send(200, job.public_state())
            return
        if len(parts) == 3 and parts[2] == "result":
            zip_path = osp.join(job.dir, "result.zip")
            if job.status != "done" or not osp.isfile(zip_path):
                self._send(job.status if job.status == "error" else 409,
                           {"error": "job not done", "status": job.status})
                return
            with open(zip_path, "rb") as f:
                self._send(200, f.read(), content_type="application/zip")
            return
        self._send(404, {"error": "not found"})

    def do_PUT(self):
        parsed = urlparse(self.path)
        parts = [p for p in parsed.path.split("/") if p]
        if parts != ["jobs"]:
            self._send(404, {"error": "not found"})
            return
        params = parse_qs(parsed.query)
        display_name = (params.get("name") or ["input.png"])[0]
        display_name = re.sub(r"[^A-Za-z0-9._()-]+", "_", display_name)[:80] or "input.png"
        quality = (params.get("quality") or ["standard"])[0]
        if quality not in QUALITY_PRESETS:
            self._send(400, {"error": "quality must be standard|draft"})
            return
        if not osp.isfile(INFERENCE_SCRIPT):
            self._send(500, {"error": "see-through not found: %s" % INFERENCE_SCRIPT})
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send(400, {"error": "empty or oversized body (max %d bytes)" % MAX_BODY_BYTES})
            return
        body = self.rfile.read(length)
        if not body.startswith(PNG_MAGIC):
            self._send(400, {"error": "body is not a PNG file"})
            return

        job_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
        job = Job(job_id, quality, display_name)
        os.makedirs(job.dir, exist_ok=True)
        with open(osp.join(job.dir, "input.png"), "wb") as f:
            f.write(body)
        WORKER.submit(job)
        state = job.public_state()
        self._send(200, {
            "jobId": job.id,
            "status": state["status"],
            "quality": quality,
            "etaMinutes": state["etaMinutes"],
        })


def main():
    os.makedirs(JOBS_DIR, exist_ok=True)
    WORKER.start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("[hq-companion] v%s listening on http://127.0.0.1:%d (jobs: %s)" % (VERSION, PORT, JOBS_DIR))
    print("[hq-companion] see-through: %s" % SEE_THROUGH_DIR)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[hq-companion] shutdown")


if __name__ == "__main__":
    main()
