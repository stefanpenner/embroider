import { NodePath } from '@babel/traverse';
import { identifier, File, ExpressionStatement, CallExpression } from '@babel/types';
import { parse } from '@babel/core';
import State, { sourceFile } from './state';
import { PackageCache, Package } from '@embroider/core';
import error from './error';
import { assertArray } from './evaluate-json';

export default function getConfig(path: NodePath, state: State, packageCache: PackageCache, own: boolean) {
  if (path.parent.type !== 'CallExpression') {
    throw error(path, `You can only use ${own ? 'getOwnConfig' : 'getConfig'} as a function call`);
  }
  let packageName: string | undefined;
  if (own) {
    if (path.parent.arguments.length !== 0) {
      throw error(path.parentPath, `getOwnConfig takes zero arguments, you passed ${path.parent.arguments.length}`);
    }
    packageName = undefined;
  } else {
    if (path.parent.arguments.length !== 1) {
      throw error(path.parentPath, `getConfig takes exactly one argument, you passed ${path.parent.arguments.length}`);
    }
    let packageNode = path.parent.arguments[0];
    if (packageNode.type !== 'StringLiteral') {
      throw error(assertArray(path.parentPath.get('arguments'))[0], `the argument to getConfig must be a string literal`);
    }
    packageName = packageNode.value;
  }
  let config: unknown | undefined;
  let pkg = targetPackage(sourceFile(path, state), packageName, packageCache);
  if (pkg) {
    config = state.opts.userConfigs[pkg.root];
  }
  path.parentPath.replaceWith(literalConfig(config));
}

function targetPackage(fromPath: string, packageName: string | undefined, packageCache: PackageCache): Package | null {
  let us = packageCache.ownerOfFile(fromPath);
  if (!us) {
    throw new Error(`unable to determine which npm package owns the file ${fromPath}`);
  }
  if (!packageName) {
    return us;
  }
  try {
    return packageCache.resolve(packageName, us);
  } catch (err) {
    return null;
  }
}

function literalConfig(config: unknown | undefined) {
  if (typeof config === 'undefined') {
    return identifier('undefined');
  }
  let ast = parse(`a(${JSON.stringify(config)})`, {}) as File;
  let statement = ast.program.body[0] as ExpressionStatement;
  let expression = statement.expression as CallExpression;
  return expression.arguments[0];
}
