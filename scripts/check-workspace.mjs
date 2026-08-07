import { builtinModules } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const applicationDirectories = new Set(['backend', 'admin-web', 'pos-electron']);
const applicationPackageNames = new Map([
  ['backend', 'athr-operations-api'],
  ['admin-web', 'athr-operations-admin'],
  ['pos-electron', 'athr-pos-electron'],
]);
const forbiddenDomainDependencies = new Set([
  '@nestjs/common',
  '@nestjs/core',
  '@prisma/client',
  'electron',
  'next',
  'react',
  'react-dom',
]);
// ATHR Dependency Rules v1.0 §3: layering is strictly one-directional —
// @athr/contracts MAY depend on @athr/domain-core, never the reverse, and
// @athr/testing is a dev-only leaf that nothing below it may depend on.
// These are the packages sitting at the bottom of the graph, and the
// packages they must never import from (directly or transitively via
// package.json), regardless of build-order or install/hoisting quirks that
// might otherwise let the edge "work" locally.
const forbiddenReverseDependencies = new Map([
  ['packages/domain-core', new Set(['@athr/contracts', '@athr/testing'])],
  ['packages/error-registry', new Set(['@athr/contracts', '@athr/testing'])],
]);
const builtinPackages = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  'node:test',
]);
const requiredNativeToolchainPackages = new Map([
  ['@rollup/rollup-linux-x64-gnu', '4.62.2'],
  ['@rollup/rollup-win32-x64-msvc', '4.62.2'],
]);

export function findCycles(graph) {
  const cycles = [];
  const visited = new Set();
  const active = [];
  const activeSet = new Set();

  function visit(node) {
    if (activeSet.has(node)) {
      const start = active.indexOf(node);
      cycles.push([...active.slice(start), node]);
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    active.push(node);
    activeSet.add(node);
    for (const dependency of graph.get(node) ?? []) visit(dependency);
    active.pop();
    activeSet.delete(node);
  }

  for (const node of graph.keys()) visit(node);
  return cycles;
}

export function packageNameFromSpecifier(specifier) {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('@/') ||
    builtinPackages.has(specifier)
  ) {
    return null;
  }

  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function workspaceDirectories(root) {
  const packageRoot = join(root, 'packages');
  // Directory identifiers are logical labels compared against forward-slash
  // literals throughout this file (e.g. 'packages/domain-core'); build them
  // with `/` explicitly rather than `path.join`, which emits `\` on Windows
  // and would silently defeat every directory-keyed check on that platform.
  const shared = existsSync(packageRoot)
    ? readdirSync(packageRoot)
        .map((name) => `packages/${name}`)
        .filter((directory) =>
          existsSync(join(root, directory, 'package.json')),
        )
    : [];

  return [...shared, ...applicationDirectories];
}

function readManifest(root, directory) {
  const path = join(root, directory, 'package.json');
  return {
    directory,
    path,
    manifest: JSON.parse(readFileSync(path, 'utf8')),
  };
}

function sourceFiles(root, directory) {
  const files = [];
  const ignored = new Set([
    '.git',
    '.next',
    'coverage',
    'dist',
    'dist-electron',
    'node_modules',
    'release',
  ]);

  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.(?:cjs|js|jsx|mjs|ts|tsx)$/.test(entry.name)) {
        files.push(path);
      }
    }
  }

  walk(join(root, directory));
  return files;
}

function importSpecifiers(path) {
  const source = readFileSync(path, 'utf8');
  const matches = source.matchAll(
    /(?:from\s+|import\s*\(|require\s*\(|import\s+)['"]([^'"]+)['"]/g,
  );
  // A real import/require specifier is always a static string literal and
  // never contains `${...}` interpolation. Without this guard, prose inside
  // a template-literal error message that happens to contain the word
  // "from" followed by a quoted `${...}` segment (e.g. `from "${a}" to
  // "${b}"`) is misread as `import ... from "${a}"` and reported as an
  // undeclared dependency — a false positive on a domain error message, not
  // an actual import.
  return [...matches]
    .map((match) => match[1])
    .filter((specifier) => !specifier.includes('${'));
}

export function validateWorkspace(root = repositoryRoot) {
  const failures = [];
  const rootManifest = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8'),
  );
  const rootLock = JSON.parse(
    readFileSync(join(root, 'package-lock.json'), 'utf8'),
  );
  const workspaces = workspaceDirectories(root).map((directory) =>
    readManifest(root, directory),
  );
  const names = new Map(
    workspaces.map((workspace) => [workspace.manifest.name, workspace]),
  );
  const graph = new Map();

  if (rootManifest.private !== true || !Array.isArray(rootManifest.workspaces)) {
    failures.push('Root package must be a private npm workspace.');
  }
  if (rootManifest.dependencies || rootManifest.optionalDependencies) {
    failures.push('Root workspace must not contain runtime dependencies.');
  }
  if (!existsSync(join(root, 'package-lock.json'))) {
    failures.push('The authoritative root package-lock.json is missing.');
  }
  for (const [dependency, version] of requiredNativeToolchainPackages) {
    const locked = Object.entries(rootLock.packages ?? {}).some(
      ([path, metadata]) =>
        (path === `node_modules/${dependency}` ||
          path.endsWith(`/node_modules/${dependency}`)) &&
        metadata.version === version,
    );
    if (!locked) {
      failures.push(
        `Root lockfile must include ${dependency}@${version} for cross-platform CI.`,
      );
    }
  }

  const railwayConfig = readFileSync(
    join(root, 'backend', 'railway.toml'),
    'utf8',
  );
  const dockerfile = readFileSync(
    join(root, 'backend', 'Dockerfile'),
    'utf8',
  );
  const vercelConfig = JSON.parse(
    readFileSync(join(root, 'vercel.json'), 'utf8'),
  );

  if (!/dockerfilePath\s*=\s*"backend\/Dockerfile"/.test(railwayConfig)) {
    failures.push('Railway must build backend/Dockerfile from repository root.');
  }
  if (
    (railwayConfig.match(/npm run prisma:migrate:deploy/g) ?? []).length !== 1
  ) {
    failures.push('Railway config must declare exactly one migration runner.');
  }
  if (/CMD\s+\[[^\]]*(?:prisma|migrate)/i.test(dockerfile)) {
    failures.push('Backend runtime CMD must not execute database migrations.');
  }

  // The runtime stage copies each shared package's build output in by hand, so
  // adding an @athr/* dependency to backend/package.json without adding the
  // matching COPY produces an image that builds fine and then dies at boot with
  // MODULE_NOT_FOUND. That is only observable through a real container run, so
  // assert it here instead — this check needs no Docker daemon.
  const backendManifest = names.get('athr-operations-api')?.manifest;
  for (const dependency of Object.keys(backendManifest?.dependencies ?? {})) {
    if (!dependency.startsWith('@athr/')) continue;
    const packageDirectory = dependency.slice('@athr/'.length);
    if (!dockerfile.includes(`/app/packages/${packageDirectory}/dist`)) {
      failures.push(
        `Backend Dockerfile runtime stage must copy /app/packages/${packageDirectory}/dist for the ${dependency} dependency.`,
      );
    }
  }
  if (
    vercelConfig.installCommand !== 'npm ci' ||
    vercelConfig.outputDirectory !== '.next'
  ) {
    failures.push(
      'Vercel must resolve the root workspace and publish the admin-web project-root .next directory.',
    );
  }

  for (const legacyLock of [
    'backend/package-lock.json',
    'admin-web/package-lock.json',
    'pos-electron/package-lock.json',
  ]) {
    if (existsSync(join(root, legacyLock))) {
      failures.push(`Legacy child lockfile must be removed: ${legacyLock}.`);
    }
  }

  for (const workspace of workspaces) {
    const { directory, manifest } = workspace;
    const dependencyGroups = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.optionalDependencies,
      manifest.peerDependencies,
    ].filter(Boolean);
    const declared = new Set(
      dependencyGroups.flatMap((group) => Object.keys(group)),
    );
    const workspaceDependencies = new Set(
      [...declared].filter((dependency) => names.has(dependency)),
    );
    graph.set(manifest.name, workspaceDependencies);

    const expectedApplicationName = applicationPackageNames.get(directory);
    if (
      (expectedApplicationName && manifest.name !== expectedApplicationName) ||
      (!expectedApplicationName && !manifest.name?.startsWith('@athr/'))
    ) {
      failures.push(
        expectedApplicationName
          ? `${directory} must preserve the application identity ${expectedApplicationName}.`
          : `${directory} must use an @athr/* shared-package name.`,
      );
    }

    if (directory === 'admin-web' || directory === 'pos-electron') {
      for (const [dependency, version] of requiredNativeToolchainPackages) {
        if (manifest.optionalDependencies?.[dependency] !== version) {
          failures.push(
            `${directory} must pin optional ${dependency}@${version}.`,
          );
        }
      }
    }

    for (const group of dependencyGroups) {
      for (const [dependency, version] of Object.entries(group)) {
        if (
          dependency.startsWith('bold-') ||
          dependency === 'athr-workspace' ||
          version === 'file:..'
        ) {
          failures.push(
            `${manifest.name} has forbidden dependency ${dependency}@${version}.`,
          );
        }
        if (forbiddenReverseDependencies.get(directory)?.has(dependency)) {
          failures.push(
            `${manifest.name} must not depend on ${dependency} (forbidden reverse edge per ATHR Dependency Rules v1.0 §3).`,
          );
        }
        if (
          applicationDirectories.has(directory) &&
          names.has(dependency) &&
          applicationDirectories.has(names.get(dependency).directory)
        ) {
          failures.push(
            `${manifest.name} must not depend on application ${dependency}.`,
          );
        }
      }
    }

    if (directory.startsWith('packages/') && !manifest.exports) {
      failures.push(`${manifest.name} must declare explicit exports.`);
    }

    for (const path of sourceFiles(root, directory)) {
      for (const specifier of importSpecifiers(path)) {
        if (specifier.startsWith('.')) {
          const target = relative(
            root,
            resolve(dirname(path), specifier),
          ).replaceAll('\\', '/');
          const targetApplication = [...applicationDirectories].find(
            (application) =>
              target === application || target.startsWith(`${application}/`),
          );

          if (targetApplication && targetApplication !== directory) {
            failures.push(
              `${relative(root, path)} imports source from ${targetApplication}.`,
            );
          }
        }

        const dependency = packageNameFromSpecifier(specifier);
        if (!dependency) continue;

        if (dependency.startsWith('bold-')) {
          failures.push(
            `${relative(root, path)} imports forbidden ${dependency}.`,
          );
        }
        if (
          dependency !== manifest.name &&
          !declared.has(dependency)
        ) {
          failures.push(
            `${relative(root, path)} imports undeclared dependency ${dependency}.`,
          );
        }
        if (
          directory === 'packages/domain-core' &&
          forbiddenDomainDependencies.has(dependency)
        ) {
          failures.push(`@athr/domain-core must not import ${dependency}.`);
        }
        if (forbiddenReverseDependencies.get(directory)?.has(dependency)) {
          failures.push(
            `${relative(root, path)} imports ${dependency}, a forbidden reverse edge per ATHR Dependency Rules v1.0 §3.`,
          );
        }
        if (
          (directory === 'packages/contracts' ||
            directory === 'packages/error-registry') &&
          names.has(dependency) &&
          applicationDirectories.has(names.get(dependency).directory)
        ) {
          failures.push(
            `${manifest.name} must not import application ${dependency}.`,
          );
        }
      }
    }
  }

  for (const cycle of findCycles(graph)) {
    failures.push(`Workspace dependency cycle: ${cycle.join(' -> ')}.`);
  }

  return { failures, graph, workspaces };
}

function main() {
  const { failures, graph, workspaces } = validateWorkspace();
  const mode = process.argv[2];

  if (mode === '--graph') {
    console.log(
      JSON.stringify(
        Object.fromEntries(
          [...graph].map(([name, dependencies]) => [
            name,
            [...dependencies].sort(),
          ]),
        ),
        null,
        2,
      ),
    );
  } else if (mode === '--cycles') {
    console.log(JSON.stringify(findCycles(graph), null, 2));
  } else {
    console.log(
      JSON.stringify({
        workspaceCount: workspaces.length,
        packages: workspaces
          .map(({ manifest }) => manifest.name)
          .sort(),
      }),
    );
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
