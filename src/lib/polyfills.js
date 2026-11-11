// Node globals the Mesh SDK expects in browsers. Imported before Mesh.
import { Buffer } from 'buffer';
import process from 'process/browser.js';
globalThis.Buffer ||= Buffer;
globalThis.process ||= process;
globalThis.global ||= globalThis;
