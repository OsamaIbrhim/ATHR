#!/usr/bin/env node
// WP-009 Phase 0.5 -- static guard against the class of bug that broke
// `PurchasingService.receive()` and `SellersRepository.savePeriod()`
// unconditionally against real Postgres, undetected by every existing test.
//
// The class: a nested `create`/`createMany` under a parent model's own
// `.create(`/`.update(`/`.upsert(` call, where the child model shares a
// composite FK on (tenant_id, <parent>_id) with that parent. Prisma's
// codegen excludes both composite-FK columns from that nested-create's
// input type and auto-fills them from the parent -- passing `tenant_id`
// explicitly is rejected at runtime with `PrismaClientValidationError:
// Unknown argument tenant_id`, unconditionally. TypeScript does not
// reliably catch this (see the two disclosed instances' root-cause writeups
// in the PR description), so this check parses the AST directly instead of
// relying on the type checker.
//
// Two rules, derived from the full composite-FK inventory in
// prisma/schema.prisma (not a hand-maintained list -- see buildRiskyFields
// below):
//
//   R1. A nested `create`/`createMany` under a field name that schema.prisma
//       proves is backed by a composite-tenant_id-FK child relation must not
//       pass `tenant_id` explicitly in the created row(s).
//   R2. `as any` (or `as unknown as any`) must not appear as, or inside, the
//       argument to a Prisma `.create(`, `.update(`, `.upsert(`,
//       `.createMany(`, or `.updateMany(` call. Both disclosed instances of
//       R1 involved a cast that silenced exactly the check that would have
//       caught them (receive() via a `.map()` inference boundary TS itself
//       can't see through; savePeriod() via an explicit `as any`) -- R2
//       exists because a cast on a write argument is inherently suspicious
//       regardless of which rule it might be hiding.
//
// Known limitation: R1 only recognizes a *literal* `tenant_id` key in the
// created object(s). A spread (`...someVariable`) that happens to carry
// `tenant_id` at runtime is invisible to a syntax-only check; none of the
// current call sites do this, and R2 independently flags spreads that
// originate from an `as any`-typed value.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const SCHEMA_PATH = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const SRC_DIR = path.join(__dirname, '..', 'src');

// --- Step 1: derive the risky-field target list from schema.prisma ---------

function parseModels(schemaText) {
  const models = new Map(); // name -> { arrayFields: [{field, target}], compositeTenantRelations: [{field, target, fkColumn}] }
  const modelRe = /model\s+(\w+)\s*\{([^}]*)\}/gs;
  let m;
  while ((m = modelRe.exec(schemaText))) {
    const [, name, body] = m;
    const arrayFields = [];
    const compositeTenantRelations = [];
    for (const line of body.split('\n')) {
      const arrayMatch = line.match(/^\s*(\w+)\s+(\w+)\[\]/);
      if (arrayMatch) {
        arrayFields.push({ field: arrayMatch[1], target: arrayMatch[2] });
      }
      const relMatch = line.match(
        /^\s*(\w+)\s+(\w+)\??\s+@relation\((?:"\w+",\s*)?fields:\s*\[tenant_id,\s*(\w+)\],\s*references:\s*\[tenant_id,\s*id\]/,
      );
      if (relMatch) {
        compositeTenantRelations.push({ field: relMatch[1], target: relMatch[2], fkColumn: relMatch[3] });
      }
    }
    models.set(name, { arrayFields, compositeTenantRelations });
  }
  return models;
}

/**
 * A parent model's array field `A: Child[]` is "risky" iff Child has a
 * composite-tenant_id relation whose target is that same parent model --
 * i.e. nested-creating Child under A shares a (tenant_id, X) FK with the
 * parent being created/updated, which is exactly the shape Prisma excludes
 * tenant_id from.
 */
function buildRiskyFields(models) {
  const risky = new Map(); // fieldName -> Set of "ParentModel.field" descriptors (for reporting)
  for (const [parentName, parentDef] of models) {
    for (const { field, target: childName } of parentDef.arrayFields) {
      const childDef = models.get(childName);
      if (!childDef) continue;
      const backRelation = childDef.compositeTenantRelations.find((r) => r.target === parentName);
      if (!backRelation) continue;
      if (!risky.has(field)) risky.set(field, new Set());
      risky.get(field).add(`${parentName}.${field} -> ${childName}[] (shared column: tenant_id, ${backRelation.fkColumn})`);
    }
  }
  return risky;
}

// --- Step 2: walk the TS AST for R1 (nested create + explicit tenant_id) and
// R2 (`as any` on a Prisma write argument) -----------------------------------

const WRITE_METHODS = new Set(['create', 'update', 'upsert', 'createMany', 'updateMany']);

function objectHasLiteralKey(objectLiteral, keyName) {
  return objectLiteral.properties.some((p) => {
    if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) {
      const nameNode = p.name;
      if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode)) {
        return nameNode.text === keyName;
      }
    }
    return false;
  });
}

function collectCreatedRowObjects(createValueNode) {
  // `create: [{...}, {...}]` or `create: {...}` or `create: arr.map(x => ({...}))`
  const rows = [];
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      rows.push(node);
      return; // don't descend into nested object literals of this row
    }
    if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach(visit);
      return;
    }
    if (ts.isCallExpression(node) && ts.isArrowFunction(node.arguments[node.arguments.length - 1] || node)) {
      // arr.map((x) => ({...})) -- the arrow's body is the row shape
    }
    if (ts.isCallExpression(node)) {
      const lastArg = node.arguments[node.arguments.length - 1];
      if (lastArg && (ts.isArrowFunction(lastArg) || ts.isFunctionExpression(lastArg))) {
        const body = lastArg.body;
        if (ts.isParenthesizedExpression(body)) visit(body.expression);
        else if (ts.isObjectLiteralExpression(body)) visit(body);
        // block-bodied arrows (return statements) are not handled -- none of
        // the current call sites use one for a nested-create row mapper.
      }
    }
  }
  visit(createValueNode);
  return rows;
}

function checkFile(filePath, riskyFields, findings) {
  const text = fs.readFileSync(filePath, 'utf8');
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const relPath = path.relative(path.join(__dirname, '..'), filePath).replace(/\\/g, '/');

  function lineOf(node) {
    return source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  }

  function visit(node) {
    // R1
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && riskyFields.has(node.name.text)) {
      const value = node.initializer;
      if (ts.isObjectLiteralExpression(value)) {
        for (const prop of value.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            (prop.name.text === 'create' || prop.name.text === 'createMany')
          ) {
            const target = prop.name.text === 'createMany' && ts.isObjectLiteralExpression(prop.initializer)
              ? prop.initializer.properties.find(
                  (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'data',
                )?.initializer
              : prop.initializer;
            if (!target) continue;
            for (const row of collectCreatedRowObjects(target)) {
              if (objectHasLiteralKey(row, 'tenant_id')) {
                findings.push({
                  rule: 'R1',
                  file: relPath,
                  line: lineOf(row),
                  message: `nested "${node.name.text}: { ${prop.name.text}: ... }" passes tenant_id explicitly -- ${[...riskyFields.get(node.name.text)].join('; ')}`,
                });
              }
            }
          }
        }
      }
    }

    // R2
    if (ts.isAsExpression(node) && node.type.getText(source) === 'any') {
      let cur = node.parent;
      let depth = 0;
      while (cur && depth < 8) {
        if (ts.isCallExpression(cur)) {
          const expr = cur.expression;
          if (ts.isPropertyAccessExpression(expr) && WRITE_METHODS.has(expr.name.text)) {
            findings.push({
              rule: 'R2',
              file: relPath,
              line: lineOf(node),
              message: `"as any" appears inside the argument to a Prisma .${expr.name.text}() call`,
            });
          }
          break;
        }
        cur = cur.parent;
        depth += 1;
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
}

function listTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const schemaText = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const models = parseModels(schemaText);
  const riskyFields = buildRiskyFields(models);

  const findings = [];
  for (const file of listTsFiles(SRC_DIR)) {
    checkFile(file, riskyFields, findings);
  }

  if (findings.length === 0) {
    process.stdout.write(`PASS  no nested-create composite-FK violations found (${riskyFields.size} risky field name(s) checked across ${listTsFiles(SRC_DIR).length} files)\n`);
    process.exitCode = 0;
    return;
  }

  for (const f of findings) {
    process.stdout.write(`FAIL  [${f.rule}] ${f.file}:${f.line} -- ${f.message}\n`);
  }
  process.stdout.write(`\n${findings.length} violation(s) found\n`);
  process.exitCode = 1;
}

main();
