import fs from 'node:fs';
import path from 'node:path';
import type { ProjectRecord } from './types.js';
import { canonicalPathSync, isSubpath, pathKey, shortHash } from './util.js';

export interface WorkspaceHint {
  id?: string;
  path: string;
  title?: string;
}

export interface ProjectCandidate {
  id: string;
  name: string;
  rootPath: string;
  canonicalKey: string;
  gitRoot?: string;
  markers: string[];
  workspaceId?: string;
}

const CONFIG_MARKERS = [
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lockb',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'Cargo.toml',
  'go.mod',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'CMakeLists.txt',
  'Gemfile',
  'mix.exs',
  'deno.json',
  'deno.jsonc',
];

const OTHER_MARKERS = ['.git', '.hg', '.svn'];

function exists(candidate: string): boolean {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}

export function findGitRoot(cwd: string): string | undefined {
  let current = canonicalPathSync(cwd);
  const root = path.parse(current).root;
  while (true) {
    if (exists(path.join(current, '.git'))) return current;
    if (current === root) return undefined;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function findConfigRoot(cwd: string): string | undefined {
  let current = canonicalPathSync(cwd);
  const root = path.parse(current).root;
  while (true) {
    if (CONFIG_MARKERS.some((marker) => exists(path.join(current, marker)))) return current;
    if (current === root) return undefined;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function markersAt(root: string): string[] {
  const markers: string[] = [];
  for (const marker of [...OTHER_MARKERS, ...CONFIG_MARKERS]) {
    if (exists(path.join(root, marker))) markers.push(marker);
  }
  return markers;
}

function readPackageName(root: string): string | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
    const display = raw['displayName'];
    if (typeof display === 'string' && display.trim()) return display.trim();
    const name = raw['name'];
    if (typeof name === 'string' && name.trim()) return name.trim();
  } catch {
    // fall through
  }
  return undefined;
}

function readSimpleTomlName(root: string, file: string): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(root, file), 'utf8');
    const match = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(raw);
    if (match?.[1]?.trim()) return match[1].trim();
  } catch {
    // fall through
  }
  return undefined;
}

function readGoModuleName(root: string): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(root, 'go.mod'), 'utf8');
    const match = /^\s*module\s+(\S+)/m.exec(raw);
    if (match?.[1]?.trim()) return match[1].trim().split('/').at(-1);
  } catch {
    // fall through
  }
  return undefined;
}

export function readProjectName(root: string): string {
  return (
    readPackageName(root) ||
    readSimpleTomlName(root, 'pyproject.toml') ||
    readSimpleTomlName(root, 'Cargo.toml') ||
    readGoModuleName(root) ||
    path.basename(root) ||
    path.parse(root).root
  );
}

export function projectIdForRoot(root: string): string {
  return `prj_${shortHash(pathKey(root), 16)}`;
}

function candidate(root: string, workspace?: WorkspaceHint): ProjectCandidate {
  const canonical = canonicalPathSync(root);
  return {
    id: projectIdForRoot(canonical),
    name: workspace?.title?.trim() || readProjectName(canonical),
    rootPath: canonical,
    canonicalKey: pathKey(canonical),
    gitRoot: findGitRoot(canonical),
    markers: markersAt(canonical),
    ...workspace?.id === undefined ? {} : { workspaceId: workspace.id },
  };
}

/**
 * Resolve one project using the documented priority:
 *   1. an exact registered DSH Workspace root,
 *   2. the Git repository root,
 *   3. the nearest project configuration root,
 *   4. the longest registered memory-project path containing cwd,
 *   5. the working directory itself.
 *
 * Folder names are never used as identity. Two same-named projects in different
 * locations produce different ids because the id hashes the canonical path.
 */
export function detectProject(
  cwd: string | undefined,
  registered: ProjectRecord[],
  workspaces: WorkspaceHint[] = [],
): ProjectCandidate | null {
  if (!cwd || !path.isAbsolute(cwd)) return null;
  const canonical = canonicalPathSync(cwd);
  const cwdKey = pathKey(canonical);

  const exactWorkspace = workspaces.find((workspace) => pathKey(workspace.path) === cwdKey);
  if (exactWorkspace) return candidate(canonical, exactWorkspace);

  const gitRoot = findGitRoot(canonical);
  if (gitRoot) return candidate(gitRoot);

  const configRoot = findConfigRoot(canonical);
  if (configRoot) return candidate(configRoot);

  const containing = registered
    .filter((project) => !project.archived && isSubpath(canonical, project.rootPath))
    .sort((a, b) => pathKey(b.rootPath).length - pathKey(a.rootPath).length);
  if (containing[0]) {
    const match = containing[0];
    return {
      id: match.id,
      name: match.name,
      rootPath: match.rootPath,
      canonicalKey: match.canonicalKey,
      ...match.gitRoot === undefined ? {} : { gitRoot: match.gitRoot },
      markers: match.markers,
    };
  }

  const workspacePrefix = workspaces
    .filter((workspace) => isSubpath(canonical, workspace.path))
    .sort((a, b) => pathKey(b.path).length - pathKey(a.path).length)[0];
  if (workspacePrefix) return candidate(workspacePrefix.path, workspacePrefix);

  return candidate(canonical);
}

export function projectSummaryRoot(project: ProjectRecord): string {
  return project.rootPath;
}
