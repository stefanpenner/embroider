import Plugin from "broccoli-plugin";
import { join } from 'path';
import {
  emptyDirSync,
  ensureSymlinkSync,
  ensureDirSync,
  realpathSync,
  mkdtempSync,
  copySync,
} from 'fs-extra';
import { Workspace, Package } from '@embroider/core';
import V1InstanceCache from "./v1-instance-cache";
import { V1AddonConstructor } from "./v1-addon";
import { tmpdir } from 'os';
import MovedPackageCache from "./moved-package-cache";
import MovedPackage from "./moved-package";
import { Memoize } from "typescript-memoize";

interface Options {
  workspaceDir?: string;
  compatAdapters?: Map<string, V1AddonConstructor>;
  emitNewRoot?: (path: string) => void;
}

export default class CompatWorkspace extends Plugin implements Workspace {
  private didBuild: boolean;
  private destDir: string;
  private moved: MovedPackageCache;

  constructor(legacyEmberAppInstance: object, options?: Options) {
    let destDir;
    if (options && options.workspaceDir) {
      ensureDirSync(options.workspaceDir);
      destDir = realpathSync(options.workspaceDir);
    } else {
      destDir = mkdtempSync(join(tmpdir(), 'embroider-'));
    }

    let v1Cache = V1InstanceCache.forApp(legacyEmberAppInstance);

    if (options && options.compatAdapters) {
      for (let [packageName, adapter] of options.compatAdapters) {
        v1Cache.registerCompatAdapter(packageName, adapter);
      }
    }

    let moved = new MovedPackageCache(destDir, v1Cache);

    super(moved.all.map(pkg => pkg.tree), {
      annotation: 'embroider:core:workspace',
      persistentOutput: true,
      needsCache: false
    });

    this.didBuild = false;
    this.moved = moved;
    this.destDir = destDir;
    if (options && options.emitNewRoot) {
      options.emitNewRoot(this.appDestDir);
    }
  }

  async ready(): Promise<{ appDestDir: string, app: Package }>{
    await this.deferReady.promise;
    return {
      appDestDir: this.moved.appDestDir,
      app: this.moved.app
    };
  }

  get appDestDir(): string {
    return this.moved.appDestDir;
  }

  get app(): Package {
    return this.moved.app;
  }

  async build() {
    if (this.didBuild) {
      // TODO: we can selectively allow some addons to rebuild, equivalent to
      // the old isDevelopingAddon.
      return;
    }

    emptyDirSync(this.destDir);

    this.moved.all.forEach((movedPkg, index) => {
      copySync(this.inputPaths[index], movedPkg.root, { dereference: true });
      this.linkNonCopiedDeps(movedPkg, movedPkg.root);
    });
    this.linkNonCopiedDeps(this.app, this.appDestDir);
    await this.moved.updatePreexistingResolvableSymlinks();
    this.didBuild = true;
    this.deferReady.resolve();
  }

  @Memoize()
  private get deferReady() {
    let resolve: Function;
    let promise: Promise<void> = new Promise(r => resolve =r);
    return { resolve: resolve!, promise };
  }

  private linkNonCopiedDeps(pkg: Package, destRoot: string) {
    for (let dep of pkg.dependencies) {
      if (!(dep instanceof MovedPackage)) {
        ensureSymlinkSync(dep.root, join(destRoot, 'node_modules', dep.packageJSON.name));
      }
    }
  }
}