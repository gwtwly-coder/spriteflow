import { expose } from "comlink";
import { createWorkerService } from "../../src/browser/index.js";

expose(createWorkerService());
