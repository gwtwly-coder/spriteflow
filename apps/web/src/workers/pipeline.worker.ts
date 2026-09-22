import { createWorkerService } from "@spriteflow/pipeline/browser";
import { expose } from "comlink";

expose(createWorkerService());
