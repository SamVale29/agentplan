import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ActionExecutor, ActionPreview, ActionResult, AgentPlanAction } from "@agentplan/core";
import { ActionResultSchema, ActionType, isWithin, isRecord, truncate, toWorkspaceIdentifier } from "@agentplan/core";

export interface FilesystemExecutorOptions {
  workspaceRoot: string;
  maxFileSizeBytes?: number;
}

interface PathInput {
  path: string;
  content?: string;
  destination?: string;
  encoding?: BufferEncoding;
  recursive?: boolean;
  overwrite?: boolean;
}

function pathInput(action: AgentPlanAction): PathInput {
  if (!isRecord(action.input) || typeof action.input.path !== "string") {
    throw new Error(`Filesystem action ${action.id} requires input.path`);
  }
  return {
    path: action.input.path,
    ...(typeof action.input.content === "string" ? { content: action.input.content } : {}),
    ...(typeof action.input.destination === "string" ? { destination: action.input.destination } : {}),
    ...(typeof action.input.encoding === "string" ? { encoding: action.input.encoding as BufferEncoding } : {}),
    ...(typeof action.input.recursive === "boolean" ? { recursive: action.input.recursive } : {}),
    ...(typeof action.input.overwrite === "boolean" ? { overwrite: action.input.overwrite } : {})
  };
}

function lineDiff(before: string, after: string): string {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  let added = 0;
  let removed = 0;
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < max; index += 1) {
    if (beforeLines[index] !== afterLines[index]) {
      if (afterLines[index] !== undefined) {
        added += 1;
      }
      if (beforeLines[index] !== undefined) {
        removed += 1;
      }
    }
  }
  return `+${added} lines, -${removed} lines`;
}

export class FilesystemActionExecutor implements ActionExecutor {
  public readonly name = "filesystem";
  private readonly workspaceRoot: string;
  private readonly maxFileSizeBytes: number;

  public constructor(options: FilesystemExecutorOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.maxFileSizeBytes = Math.min(Math.max(options.maxFileSizeBytes ?? 5 * 1024 * 1024, 1_024), 100 * 1024 * 1024);
  }

  public supports(action: AgentPlanAction): boolean {
    return action.type.startsWith("filesystem.");
  }

  public async preview(action: AgentPlanAction): Promise<ActionPreview> {
    const input = pathInput(action);
    const target = await this.safePath(input.path);
    if (action.type === ActionType.FilesystemRead) {
      const metadata = await stat(target);
      return { summary: `Read ${toWorkspaceIdentifier(this.workspaceRoot, target)}`, details: [`${metadata.size} bytes`, `Workspace: ${this.workspaceRoot}`] };
    }
    if (action.type === ActionType.FilesystemWrite) {
      const content = input.content ?? "";
      let before = "";
      try {
        before = await readFile(target, { encoding: input.encoding ?? "utf8" });
      } catch (error) {
        if (!this.isNotFound(error)) {
          throw error;
        }
      }
      return { summary: `Write ${toWorkspaceIdentifier(this.workspaceRoot, target)}`, details: [lineDiff(before, content)], estimatedDiff: lineDiff(before, content) };
    }
    return { summary: `${action.type} ${toWorkspaceIdentifier(this.workspaceRoot, target)}`, details: ["Preview does not mutate the workspace."] };
  }

  public async execute(action: AgentPlanAction): Promise<ActionResult> {
    const input = pathInput(action);
    const target = await this.safePath(input.path);
    const encoding = input.encoding ?? "utf8";
    if (action.type === ActionType.FilesystemRead) {
      const metadata = await stat(target);
      this.assertSize(metadata.size, target);
      const content = await readFile(target, { encoding });
      return ActionResultSchema.parse({ success: true, summary: `Read ${toWorkspaceIdentifier(this.workspaceRoot, target)}`, output: truncate(content, this.maxFileSizeBytes), affectedResources: [action.resource] });
    }
    if (action.type === ActionType.FilesystemWrite) {
      if (input.content === undefined) {
        throw new Error(`Filesystem write ${action.id} requires input.content`);
      }
      this.assertSize(Buffer.byteLength(input.content, encoding), target);
      await mkdir(path.dirname(target), { recursive: true });
      await this.assertNoExternalSymlink(target);
      await writeFile(target, input.content, { encoding, flag: input.overwrite === false ? "wx" : "w", mode: 0o600 });
      return ActionResultSchema.parse({ success: true, summary: `Wrote ${toWorkspaceIdentifier(this.workspaceRoot, target)}`, affectedResources: [action.resource] });
    }
    if (action.type === ActionType.FilesystemMove) {
      if (!input.destination) {
        throw new Error(`Filesystem move ${action.id} requires input.destination`);
      }
      const destination = await this.safePath(input.destination);
      await mkdir(path.dirname(destination), { recursive: true });
      await this.assertNoExternalSymlink(destination);
      if (input.overwrite !== true) {
        try {
          await lstat(destination);
          throw new Error(`Destination already exists: ${input.destination}`);
        } catch (error) {
          if (!this.isNotFound(error)) {
            throw error;
          }
        }
      }
      await rename(target, destination);
      return ActionResultSchema.parse({ success: true, summary: `Moved ${toWorkspaceIdentifier(this.workspaceRoot, target)} to ${toWorkspaceIdentifier(this.workspaceRoot, destination)}`, affectedResources: [action.resource, { kind: "file", identifier: toWorkspaceIdentifier(this.workspaceRoot, destination) }] });
    }
    if (action.type === ActionType.FilesystemDelete) {
      const metadata = await lstat(target);
      if (metadata.isDirectory() && input.recursive !== true) {
        throw new Error("Directory deletion requires input.recursive=true");
      }
      await rm(target, { recursive: input.recursive === true, force: false });
      return ActionResultSchema.parse({ success: true, summary: `Deleted ${toWorkspaceIdentifier(this.workspaceRoot, target)}`, affectedResources: [action.resource] });
    }
    throw new Error(`Unsupported filesystem action: ${action.type}`);
  }

  private async safePath(requestedPath: string): Promise<string> {
    const target = path.resolve(this.workspaceRoot, requestedPath);
    if (!isWithin(this.workspaceRoot, target)) {
      throw new Error(`Path is outside the configured workspace: ${requestedPath}`);
    }
    await this.assertNoExternalSymlink(target);
    return target;
  }

  private async assertNoExternalSymlink(target: string): Promise<void> {
    const relative = path.relative(this.workspaceRoot, target);
    let current = this.workspaceRoot;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try {
        const metadata = await lstat(current);
        if (metadata.isSymbolicLink()) {
          const resolved = await realpath(current);
          if (!isWithin(this.workspaceRoot, resolved)) {
            throw new Error(`Symlink resolves outside the configured workspace: ${current}`);
          }
          current = resolved;
        }
      } catch (error) {
        if (this.isNotFound(error)) {
          return;
        }
        throw error;
      }
    }
  }

  private assertSize(size: number, target: string): void {
    if (size > this.maxFileSizeBytes) {
      throw new Error(`File exceeds the ${this.maxFileSizeBytes}-byte safety limit: ${target}`);
    }
  }

  private isNotFound(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }
}
