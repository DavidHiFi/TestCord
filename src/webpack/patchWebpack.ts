/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated, Nuckyz, and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PatchVersioning } from "@api/PatchVersioning";
import { PluginHealth } from "@api/PluginHealth";
import { Settings } from "@api/Settings";
import { reporterData } from "@debug/reporterData";
import { traceFunctionWithResults } from "@debug/Tracer";
import { makeLazy } from "@utils/lazy";
import { Logger } from "@utils/Logger";
import { interpolateIfDefined } from "@utils/misc";
import { Patch, PatchReplacement } from "@utils/types";
import { WebpackRequire } from "@vencord/discord-types/webpack";

import { AnyModuleFactory, AnyWebpackRequire, MaybePatchedModuleFactory, PatchedModuleFactory } from "./types";
import { _blacklistBadModules, _initWebpack, factoryListeners, findModuleFactory, moduleListeners, waitForSubscriptions, wreq } from "./webpack";

export const patches = [] as Patch[];

export function removePatchesByPlugin(pluginName: string) {
    for (let i = patches.length - 1; i >= 0; i--) {
        if (patches[i].plugin === pluginName) {
            patches.splice(i, 1);
        }
    }
}

export const SYM_ORIGINAL_MODULE_FACTORIES = Symbol("WebpackPatcher.originalModuleFactories");
export const SYM_IS_PROXIED_FACTORY = Symbol("WebpackPatcher.isProxiedFactory");
export const SYM_ORIGINAL_FACTORY = Symbol("WebpackPatcher.originalFactory");
export const SYM_PATCHED_SOURCE = Symbol("WebpackPatcher.patchedSource");
export const SYM_PATCHED_BY = Symbol("WebpackPatcher.patchedBy");
export const allWebpackInstances = new Set<AnyWebpackRequire>();

export const patchTimings = [] as Array<[plugin: string, moduleId: PropertyKey, match: PatchReplacement["match"], totalTime: number]>;

export function clearPatchTimings() {
    patchTimings.length = 0;
}

export const getBuildNumber = makeLazy(() => {
    try {
        function matchBuildNumber(factoryStr: string) {
            const buildNumberMatch = factoryStr.match(/"Trying to open a changelog for an invalid build number (\d+?)"\)/);
            if (buildNumberMatch == null) {
                return -1;
            }

            return Number(buildNumberMatch[1]);
        }

        const hardcodedFactoryStr = String(wreq.m[927815]);
        if (hardcodedFactoryStr.includes("Trying to open a changelog for an invalid build number")) {
            const hardcodedBuildNumber = matchBuildNumber(hardcodedFactoryStr);

            if (hardcodedBuildNumber !== -1) {
                return hardcodedBuildNumber;
            }
        } else if (IS_DEV || IS_REPORTER) {
            logger.error("Hardcoded build number module id is invalid");
        }

        const moduleFactory = findModuleFactory("Trying to open a changelog for an invalid build number");
        return matchBuildNumber(String(moduleFactory));
    } catch {
        return -1;
    }
});

export function getFactoryPatchedSource(moduleId: PropertyKey, webpackRequire = wreq as AnyWebpackRequire) {
    return webpackRequire.m[moduleId]?.[SYM_PATCHED_SOURCE];
}

export function getFactoryPatchedBy(moduleId: PropertyKey, webpackRequire = wreq as AnyWebpackRequire) {
    return webpackRequire.m[moduleId]?.[SYM_PATCHED_BY];
}

const logger = new Logger("WebpackPatcher", "#8caaee");

const AT_DIGIT_RE = /at \d+? \(/;
const ASSETS_FILE_RE = /\/assets\/(.+?\.js)/;
const IGNORED_INSTANCE_NAMES = ["sentry", "libdiscore", "fast-connect"];

/** Whether we tried to fallback to the WebpackRequire of the factory, or disabled patches */
let wreqFallbackApplied = false;

const define: typeof Reflect.defineProperty = (target, p, attributes) => {
    if (Object.hasOwn(attributes, "value")) {
        attributes.writable = true;
    }

    attributes.configurable = true;
    attributes.enumerable ??= true;

    return Reflect.defineProperty(target, p, attributes);
};

// wreq.m is the Webpack object containing module factories. It is pre-populated with factories, and is also populated via webpackGlobal.push
// We use this setter to intercept when wreq.m is defined and setup our setters which decide whether we should patch these module factories
// and the Webpack instance where they are being defined.

// Factories can be patched in two ways. Eagerly or lazily.
// If we are patching eagerly, pre-populated factories are patched immediately and new factories are patched when set.
// Else, we only patch them when called.

// Factories are always wrapped in a proxy, which allows us to intercept the call to them, patch if they werent eagerly patched,
// and call them with our wrapper which notifies our listeners.

// wreq.m is also wrapped in a proxy to intercept when new factories are set, patch them eargely, if enabled, and wrap them in the factory proxy.

// If this is the main Webpack, we also set up the internal references to WebpackRequire.
define(Function.prototype, "m", {
    enumerable: false,

    set(this: AnyWebpackRequire, originalModules: AnyWebpackRequire["m"]) {
        define(this, "m", { value: originalModules });

        // Ensure this is likely one of Discord main Webpack instances.
        // We may catch Discord bundled libs, React Devtools or other extensions Webpack instances here.
        const { stack } = new Error();
        if (!stack?.includes("http") || AT_DIGIT_RE.test(stack) || !String(this).includes("exports:{}")) {
            return;
        }

        const fileName = ASSETS_FILE_RE.exec(stack)?.[1];

        // Currently, sentry and libdiscore Webpack instances are not meant to be patched.
        // As an extra measure, take advatange of the fact their files include the names and return early if it's one of them.
        // Later down we also include other measures to avoid patching them.
        const lowerFileName = fileName?.toLowerCase();
        if (lowerFileName != null && IGNORED_INSTANCE_NAMES.some(name => lowerFileName.includes(name))) {
            return;
        }

        // Define a setter for the bundlePath property of WebpackRequire. Only Webpack instances which include chunk loading functionality,
        // like the main Discord Webpack, have this property.
        // So if the setter is called with the Discord bundlePath, this means we should patch this instance and initialize the internal references to WebpackRequire.
        define(this, "p", {
            enumerable: false,

            set(this: AnyWebpackRequire, bundlePath: NonNullable<AnyWebpackRequire["p"]>) {
                define(this, "p", { value: bundlePath });
                clearTimeout(bundlePathTimeout);

                // libdiscore init Webpack instance always returns a constant string for the js filename of a chunk.
                // In that case, avoid patching this instance,
                // as it runs before the main Webpack instance and will make the WebpackRequire fallback not work properly, or init an wrongful main WebpackRequire.
                if (bundlePath !== "/assets/" || /(?:=>|{return)"[^"]+?"[^=]/.exec(String(this.u))) {
                    return;
                }

                if (wreq == null && this.c != null) {
                    logger.info("Main WebpackInstance found" + interpolateIfDefined` in ${fileName}` + ", initializing internal references to WebpackRequire");
                    _initWebpack(this as WebpackRequire);
                }

                patchThisInstance();
            }
        });

        // In the past, the sentry Webpack instance which we also wanted to patch used to rely on chunks being loaded before initing sentry.
        // This Webpack instance did not include actual chunk loading, and only awaited for them to be loaded, which means it did not include the bundlePath property.
        // To keep backwards compability, if this is ever the case again, and keep patching this type of instance, we explicity patch instances which include wreq.O and not wreq.p.
        // Since we cannot check what is the bundlePath of the instance to filter for the Discord bundlePath, we only patch it if wreq.p is not included,
        // which means the instance relies on another instance which does chunk loading, and that makes it very likely to only target Discord Webpack instances like the old sentry.

        // Instead of patching when wreq.O is defined, wait for when wreq.O.j is defined, since that will be one of the last things to happen,
        // which can assure wreq.p could have already been defined before.
        define(this, "O", {
            enumerable: false,

            set(this: AnyWebpackRequire, onChunksLoaded: NonNullable<AnyWebpackRequire["O"]>) {
                define(this, "O", { value: onChunksLoaded });
                clearTimeout(onChunksLoadedTimeout);

                const wreq = this;
                define(onChunksLoaded, "j", {
                    enumerable: false,

                    set(this: NonNullable<AnyWebpackRequire["O"]>, j: NonNullable<AnyWebpackRequire["O"]>["j"]) {
                        define(this, "j", { value: j });

                        if (wreq.p == null) {
                            patchThisInstance();
                        }
                    }
                });
            }
        });

        // If neither of these properties setters were triggered, delete them as they are not needed anymore.
        const bundlePathTimeout = setTimeout(() => Reflect.deleteProperty(this, "p"), 0);
        const onChunksLoadedTimeout = setTimeout(() => Reflect.deleteProperty(this, "O"), 0);

        /**
         * Patch the current Webpack instance assigned to `this` context.
         * This should only be called if this instance was later found to be one we need to patch.
         */
        const patchThisInstance = () => {
            logger.info("Found Webpack module factories" + interpolateIfDefined` in ${fileName}`);
            allWebpackInstances.add(this);

            // Proxy (and maybe patch) pre-populated factories
            for (const moduleId in originalModules) {
                proxyFactoryAndUpdateExisting(originalModules, moduleId, originalModules[moduleId], originalModules, true);
            }

            define(originalModules, Symbol.toStringTag, {
                value: "ModuleFactories",
                enumerable: false
            });

            const proxiedModuleFactories = new Proxy(originalModules, moduleFactoriesHandler);
            /*
            If Webpack ever decides to set module factories using the variable of the modules object directly, instead of wreq.m, switch the proxy to the prototype
            Reflect.setPrototypeOf(originalModules, new Proxy(originalModules, moduleFactoriesHandler));
            */

            define(this, "m", { value: proxiedModuleFactories });

            // Overwrite Webpack's defineExports function to define the export descriptors configurable.
            // This is needed so we can later blacklist specific exports from Webpack search by making them non-enumerable
            this.d = function (exports, definition) {
                for (const key in definition) {
                    if (Object.hasOwn(definition, key) && !Object.hasOwn(exports, key)) {
                        Object.defineProperty(exports, key, {
                            enumerable: true,
                            configurable: true,
                            get: definition[key],
                        });
                    }
                }
            };
        };
    }
});

// The proxy for patching eagerly and/or wrapping factories in their proxy.
const moduleFactoriesHandler: ProxyHandler<AnyWebpackRequire["m"]> = {
    /*
    If Webpack ever decides to set module factories using the variable of the modules object directly instead of wreq.m, we need to switch the proxy to the prototype
    and that requires defining additional traps for keeping the object working

    // Proxies on the prototype don't intercept "get" when the property is in the object itself. But in case it isn't we need to return undefined,
    // to avoid Reflect.get having no effect and causing a stack overflow
    get(target, p, receiver) {
        return undefined;
    },
    // Same thing as get
    has(target, p) {
        return false;
    },
    */

    get(target, p, receiver) {
        if (p === SYM_ORIGINAL_MODULE_FACTORIES) {
            return target;
        }

        return Reflect.get(target, p, receiver);
    },

    set: proxyFactoryAndUpdateExisting
};

// The proxy for patching lazily and/or running factories with our wrapper.
const moduleFactoryHandler: ProxyHandler<MaybePatchedModuleFactory> = {
    apply(target, thisArg: unknown, argArray: Parameters<AnyModuleFactory>) {
        // If SYM_ORIGINAL_FACTORY exists in the proxy target, it means the proxy target is already a patched factory.
        // In that case, just run it.
        if (target[SYM_ORIGINAL_FACTORY] != null) {
            return runFactoryWithWrap(target as PatchedModuleFactory, thisArg, argArray);
        }

        // SAFETY: Factories have `name` as their key in the module factories object, and that is always their module id.
        const moduleId: string = target.name;

        // Patch the proxy target, which is the original factory.
        const patchedFactory = patchFactory(moduleId, target);
        return runFactoryWithWrap(patchedFactory, thisArg, argArray);
    },

    get(target, p, receiver) {
        if (p === SYM_IS_PROXIED_FACTORY) {
            return true;
        }

        // If the proxy target is a patched factory, SYM_ORIGINAL_FACTORY will have the original factory. Otherwise the target itself will be it.
        const originalFactory: AnyModuleFactory = target[SYM_ORIGINAL_FACTORY] ?? target;

        // Redirect getting these properties from the original factory, including making `toString` return the original factory `toString`
        if (p === "toString" || p === SYM_PATCHED_SOURCE || p === SYM_PATCHED_BY) {
            const v = Reflect.get(originalFactory, p, originalFactory);
            return p === "toString" ? v.bind(originalFactory) : v;
        }

        return Reflect.get(target, p, receiver);
    }
};

function proxyFactoryAndUpdateExisting(moduleFactories: AnyWebpackRequire["m"], moduleId: PropertyKey, newFactory: AnyModuleFactory, receiver: any, ignoreExistingInTarget = false) {
    notifyFactoryListeners(moduleId, newFactory);
    const factory = Settings.eagerPatches ? patchFactory(moduleId, newFactory) : newFactory;
    if (factory !== newFactory) patchedModuleIds.add(moduleId);
    const proxiedFactory = new Proxy(factory, moduleFactoryHandler);

    if (updateExistingFactory(moduleFactories, moduleId, newFactory, proxiedFactory, ignoreExistingInTarget)) {
        return true;
    }

    return Reflect.set(moduleFactories, moduleId, proxiedFactory, receiver);
}

/**
 * Update a duplicated factory that exists in any of the Webpack instances we track with a new original and proxied factory.
 *
 * @param moduleFactories The module factories where this new original factory is being set
 * @param moduleId The id of the module
 * @param newFactory The new original factory
 * @param newProxiedFactory The new original and proxied factory
 * @param receiver The receiver of the factory
 * @param ignoreExistingInTarget Whether to ignore checking if the factory already exists in the moduleFactories where it is being set
 * @returns Whether the original factory was updated, or false if it doesn't exist in any of the tracked Webpack instances
 */
function updateExistingFactory(moduleFactories: AnyWebpackRequire["m"], moduleId: PropertyKey, newFactory: AnyModuleFactory, newProxiedFactory: AnyModuleFactory, ignoreExistingInTarget: boolean) {
    let existingFactory: AnyModuleFactory | undefined;
    for (const wreq of allWebpackInstances) {
        const instanceModuleFactories = wreq.m[SYM_ORIGINAL_MODULE_FACTORIES] ?? wreq.m;

        if (ignoreExistingInTarget && instanceModuleFactories === moduleFactories) {
            continue;
        }

        if (Object.hasOwn(wreq.m, moduleId)) {
            existingFactory = wreq.m[moduleId]; // Must use wreq.m here instead of instanceModuleFactories to use our proxy in case the module factories are already proxied.
            break;
        }
    }

    if (existingFactory != null) {
        // SYM_ORIGINAL_FACTORY means the factory has already been patched. In this case, only update existingFactory original factory to the new one.
        if (existingFactory[SYM_ORIGINAL_FACTORY] != null) {
            existingFactory[SYM_ORIGINAL_FACTORY] = newFactory;

            // Persist patched source and patched by in the new original factory
            if (IS_DEV) {
                newFactory[SYM_PATCHED_SOURCE] = existingFactory[SYM_PATCHED_SOURCE];
                newFactory[SYM_PATCHED_BY] = existingFactory[SYM_PATCHED_BY];
            }
        } else {
            defineInWebpackInstances(moduleId, newProxiedFactory);
        }

        return true;
    }

    return false;
}

/**
 * Define a module factory in all the Webpack instances we track.
 *
 * @param moduleId The id of the module
 * @param factory The factory
 */
function defineInWebpackInstances(moduleId: PropertyKey, factory: AnyModuleFactory) {
    for (const wreq of allWebpackInstances) {
        define(wreq.m, moduleId, { value: factory });
    }
}

/**
 * Notify all factory listeners.
 *
 * @param moduleId The id of the module
 * @param factory The original factory to notify for
 */
function notifyFactoryListeners(moduleId: PropertyKey, factory: AnyModuleFactory) {
    if (factoryListeners.size === 0) return;

    for (const factoryListener of factoryListeners) {
        try {
            factoryListener(factory, moduleId);
        } catch (err) {
            logger.error("Error in Webpack factory listener:\n", err, factoryListener);
        }
    }
}

const patchedModuleIds = new Set<PropertyKey>();

/**
 * Run a (possibly) patched module factory with a wrapper which notifies our listeners.
 *
 * @param patchedFactory The (possibly) patched module factory
 * @param thisArg The `value` of the call to the factory
 * @param argArray The arguments of the call to the factory
 */
function runFactoryWithWrap(patchedFactory: PatchedModuleFactory, thisArg: unknown, argArray: Parameters<MaybePatchedModuleFactory>) {
    const originalFactory = patchedFactory[SYM_ORIGINAL_FACTORY];

    if (patchedFactory === originalFactory) {
        // @ts-expect-error Clear up ORIGINAL_FACTORY if the factory did not have any patch applied
        delete patchedFactory[SYM_ORIGINAL_FACTORY];
    }

    let [module, exports, require] = argArray;
    const moduleId = module.id;

    // Restore the original factory in all the module factories objects, discarding our proxy and allowing it to be garbage collected
    defineInWebpackInstances(moduleId, originalFactory);

    if (wreq == null) {
        if (!wreqFallbackApplied) {
            wreqFallbackApplied = true;

            // Make sure the require argument is actually the WebpackRequire function
            if (typeof require === "function" && require.m != null && require.c != null) {
                const { stack } = new Error();
                const webpackInstanceFileName = ASSETS_FILE_RE.exec(stack ?? "")?.[1];

                logger.warn(
                    "WebpackRequire was not initialized, falling back to WebpackRequire passed to the first called wrapped module factory (" +
                    `id: ${String(moduleId)}` + interpolateIfDefined`, WebpackInstance origin: ${webpackInstanceFileName}` +
                    ")"
                );

                // Could technically be wrong, but it's better than nothing
                _initWebpack(require as WebpackRequire);
            } else if (IS_DEV) {
                logger.error("WebpackRequire was not initialized, running modules without patches instead.");
                return originalFactory.apply(thisArg, argArray);
            }
        } else if (IS_DEV) {
            return originalFactory.apply(thisArg, argArray);
        }
    }

    let factoryReturn: unknown;
    try {
        factoryReturn = patchedFactory.apply(thisArg, argArray);
    } catch (err) {
        // Just re-throw Discord errors
        if (patchedFactory === originalFactory) {
            throw err;
        }

        logger.error("Error in patched module factory:\n", err);
        return originalFactory.apply(thisArg, argArray);
    }

    exports = module.exports;

    if (typeof require === "function" && require.c) {
        if (_blacklistBadModules(require.c, exports, moduleId)) {
            return factoryReturn;
        }
    }

    if (exports == null) {
        return factoryReturn;
    }

    if (moduleListeners.size > 0) {
        for (const callback of moduleListeners) {
            try {
                callback(exports, moduleId);
            } catch (err) {
                logger.error("Error in Webpack module listener:\n", err, callback);
            }
        }
    }

    if (waitForSubscriptions.size === 0) {
        return factoryReturn;
    }

    for (const [filter, callback] of waitForSubscriptions) {
        try {
            if (filter(exports)) {
                waitForSubscriptions.delete(filter);
                callback(exports, moduleId);
                continue;
            }
        } catch (err) {
            logger.error(
                "Error while filtering or firing callback for Webpack waitFor subscription:\n", err,
                "\n\nModule exports:", exports,
                "\n\nFilter:", filter,
                "\n\nCallback:", callback
            );
        }

        if (typeof exports !== "object") {
            continue;
        }

        for (const exportKey in exports) {
            try {
                // Some exports might have not been initialized yet due to circular imports, so try catch it.
                try {
                    var exportValue = exports[exportKey];
                } catch {
                    continue;
                }

                if (exportValue != null && filter(exportValue)) {
                    waitForSubscriptions.delete(filter);
                    callback(exportValue, moduleId);
                    break;
                }
            } catch (err) {
                logger.error(
                    "Error while filtering or firing callback for Webpack waitFor subscription:\n", err,
                    "\n\nExport value:", exports,
                    "\n\nFilter:", filter,
                    "\n\nCallback:", callback
                );
            }
        }
    }

    return factoryReturn;
}

interface AppliedReplacement {
    plugin: string;
    find: string;
    match: string | RegExp;
    replace: string;
}

/**
 * Replacements applied per module, in order, so a module that fails to parse can be
 * bisected back to the one that broke it. Only read on the failure path.
 */
const appliedReplacements = new Map<string, AppliedReplacement[]>();

/** Whether a factory body parses. Only a SyntaxError counts as "does not parse". */
function parsesAsFactory(code: string): boolean {
    try {
        (0, eval)(`${code}\n//# sourceURL=file:///webpackmodule-probe`);
        return true;
    } catch (err) {
        return !(err instanceof SyntaxError);
    }
}

/**
 * Drop the replacements that made a module unparseable, keeping the rest.
 *
 * A module can be patched by a dozen plugins, so reverting all of them because one of
 * them broke is a terrible trade: it silently disables every other plugin on that module.
 * On the member list that took out the DM profile sidebar along with it, because the DM
 * sidebar, the member list and several unrelated plugins all live in the same factory.
 *
 * Replays the applied replacements in order, re-parsing as it goes, and stops at the
 * first one that breaks the syntax. Everything applied before it is known good, so the
 * module is rebuilt from the original code with only the offenders skipped.
 *
 * @returns Recoverable code, or null when no subset could be made to parse.
 */
function dropSyntaxOffenders(
    originalPatchedCode: string,
    moduleIdStr: string
): { code: string; offenders: AppliedReplacement[]; } | null {
    const applied = appliedReplacements.get(moduleIdStr);
    if (!applied?.length) return null;

    const offenders: AppliedReplacement[] = [];
    let good = originalPatchedCode;

    for (const entry of applied) {
        let next: string;
        try {
            next = good.replace(entry.match, entry.replace);
        } catch {
            // The replace itself threw, so it never produced code. Drop it.
            offenders.push(entry);
            continue;
        }
        if (next === good) continue; // no effect, nothing to keep or blame
        if (parsesAsFactory(next)) {
            good = next;
        } else {
            offenders.push(entry);
        }
    }

    return offenders.length > 0 ? { code: good, offenders } : null;
}

/**
 * Patches a module factory.
 *
 * @param moduleId The id of the module
 * @param originalFactory The original module factory
 * @returns The patched module factory
 */
function patchFactory(moduleId: PropertyKey, originalFactory: AnyModuleFactory): PatchedModuleFactory {
    const originalFactoryCode = String(originalFactory);
    const isArrowFunction = originalFactoryCode.startsWith("(");

    // 0, prefix to turn it into an expression: 0,function(){} would be invalid syntax without the 0,
    let patchedCode = "0," + (!isArrowFunction ? "function" : "") + originalFactoryCode.slice(originalFactoryCode.indexOf("("));
    const originalPatchedCode = patchedCode;
    let patchedSource = patchedCode;
    let patchedFactory = originalFactory;
    const moduleIdStr = String(moduleId);
    appliedReplacements.set(moduleIdStr, []);

    const patchedBy = new Set<string>();

    const buildNumber = getBuildNumber();
    const shouldCheckBuildNumber = buildNumber !== -1;

    for (let i = 0; i < patches.length; i++) {
        const patch = patches[i];

        if (
            shouldCheckBuildNumber &&
            ((patch.fromBuild != null && buildNumber < patch.fromBuild) || (patch.toBuild != null && buildNumber > patch.toBuild))
        ) {
            patches.splice(i--, 1);
            continue;
        }

        const moduleMatches = typeof patch.find === "string"
            ? originalFactoryCode.includes(patch.find)
            : (patch.find.global && (patch.find.lastIndex = 0), patch.find.test(originalFactoryCode));

        if (!moduleMatches) {
            continue;
        }

        // Save the result from the previous patch so we can restore it in case a patch group fails.
        const previousPatchedCode = patchedCode;
        const previousPatchedSource = patchedSource;
        const previousPatchedFactory = patchedFactory;

        let shouldRestorePrevious = false;
        let markedAsPatched = false;

        const executePatch = traceFunctionWithResults(`patch by ${patch.plugin}`, (match: string | RegExp, replace: string) => {
            if (typeof match !== "string" && match.global) {
                match.lastIndex = 0;
            }

            return patchedCode.replace(match, replace);
        });

        // We change all patch.replacement to array in PluginManager
        for (const replacement of patch.replacement as PatchReplacement[]) {
            if (
                shouldCheckBuildNumber &&
                ((replacement.fromBuild != null && buildNumber < replacement.fromBuild) || (replacement.toBuild != null && buildNumber > replacement.toBuild))
            ) {
                continue;
            }

            let newPatchedCode: string = "";
            try {
                const [patchResult, totalTime] = executePatch(replacement.match, replacement.replace as string);
                newPatchedCode = patchResult;

                if (IS_REPORTER) {
                    patchTimings.push([patch.plugin, moduleId, replacement.match, totalTime]);
                }

                if (newPatchedCode === patchedCode) {
                    if (!(patch.noWarn || replacement.noWarn)) {
                        logger.warn(`Patch by ${patch.plugin} had no effect (Module id is ${String(moduleId)}): ${replacement.match}`);
                        if (IS_DEV) {
                            logger.debug("Function Source:\n", patchedCode);
                        }
                        if (IS_COMPANION_TEST)
                            reporterData.failedPatches.hadNoEffect.push({
                                ...patch,
                                id: moduleId
                            });
                        PluginHealth.recordPatchFailure(patch.plugin, {
                            kind: "noEffect",
                            find: String(patch.find),
                            match: String(replacement.match),
                            moduleId: String(moduleId),
                            sourceContext: getPatchContext(originalFactoryCode, patch.find)
                        });
                    }

                    if (patch.group) {
                        logger.warn(`Undoing patch group ${patch.find} by ${patch.plugin} because replacement ${replacement.match} had no effect`);

                        if (markedAsPatched) {
                            patchedBy.delete(patch.plugin);
                        }

                        if (IS_COMPANION_TEST)
                            reporterData.failedPatches.undoingPatchGroup.push({
                                ...patch,
                                id: moduleId
                            });
                        PluginHealth.recordPatchFailure(patch.plugin, {
                            kind: "undoingGroup",
                            find: String(patch.find),
                            match: String(replacement.match),
                            moduleId: String(moduleId)
                        });

                        shouldRestorePrevious = true;
                        break;
                    }

                    continue;
                }

                if (!patchedBy.has(patch.plugin)) {
                    // Conflict detection: if another plugin already patched this
                    // module, log for dev awareness. This doesn't mean the patches are
                    // incompatible — many plugins intentionally patch the same module.
                    const otherPlugins = [...patchedBy].filter(p => p !== patch.plugin);
                    if (otherPlugins.length > 0 && IS_DEV) {
                        logger.info(`Module ${String(moduleId)} (${String(patch.find)}) patched by ${patch.plugin} was also patched by: ${otherPlugins.sort().join(", ")}`);
                    }

                    patchedBy.add(patch.plugin);
                    markedAsPatched = true;
                }

                patchedCode = newPatchedCode;
                const applied = appliedReplacements.get(moduleIdStr);
                if (applied) {
                    applied.push({
                        plugin: patch.plugin,
                        find: String(patch.find),
                        match: replacement.match,
                        replace: replacement.replace as string
                    });
                }
            } catch (err) {
                // FIXME: Maybe fix this properly
                const shouldSuppressError = patch.plugin === "ContextMenuAPI" && err instanceof SyntaxError && err.message.includes("arguments");
                if (!shouldSuppressError) {
                    logger.error(`Patch by ${patch.plugin} errored (Module id is ${String(moduleId)}): ${replacement.match}\n`, err);

                    if (IS_COMPANION_TEST)
                        reporterData.failedPatches.erroredPatch.push({
                            ...patch,
                            oldModule: patchedCode,
                            newModule: newPatchedCode,
                            id: moduleId
                        });
                    PluginHealth.recordPatchFailure(patch.plugin, {
                        kind: "errored",
                        find: String(patch.find),
                        match: String(replacement.match),
                        moduleId: String(moduleId),
                        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err)
                    });

                    if (IS_DEV) {
                        diffErroredPatch(newPatchedCode, patchedCode, patchedCode.match(replacement.match)!);
                    }
                }

                if (patch.group) {
                    logger.warn(`Undoing patch group ${patch.find} by ${patch.plugin} because replacement ${replacement.match} errored`);
                    if (IS_COMPANION_TEST)
                        reporterData.failedPatches.undoingPatchGroup.push({
                            ...patch,
                            id: moduleId
                        });
                    PluginHealth.recordPatchFailure(patch.plugin, {
                        kind: "undoingGroup",
                        find: String(patch.find),
                        match: String(replacement.match),
                        moduleId: String(moduleId)
                    });
                    shouldRestorePrevious = true;
                    break;
                }
            }
        }

        if (shouldRestorePrevious) {
            patchedCode = previousPatchedCode;
            patchedSource = previousPatchedSource;
            patchedFactory = previousPatchedFactory;

            if (markedAsPatched) {
                patchedBy.delete(patch.plugin);
            }
        }

        if (!patch.all) {
            patches.splice(i--, 1);
        }

        // Patch versioning: if this patch was successfully applied, check
        // whether the underlying Discord code changed since last session.
        if (patchedBy.has(patch.plugin)) {
            PluginHealth.clearPatchFailures(patch.plugin, failure => failure.kind === "noModule" && failure.find === String(patch.find));
            PatchVersioning.checkAndStore(
                patch.plugin,
                String(patch.find),
                originalFactoryCode,
                shouldCheckBuildNumber ? buildNumber : -1,
                String(moduleId)
            );
        }
    }

    // One eval for the whole module, not one per replacement. Every replacement used to
    // re-serialise and re-eval the entire module, so a module that nine plugins patch was
    // parsed, compiled and *executed* nine times before it was handed to webpack. Nothing
    // inside the loop reads the factory, and a group rollback only ever restores the code,
    // so the factory is derived once here from whatever survived the loop. The `return`
    // fixup is applied to that final code for the same reason it used to be applied to the
    // last replacement: `patchedCode` itself is kept unfixed so later anchors still match
    // the shape the previous replacement produced.
    if (patchedCode !== originalPatchedCode) {
        const fixedCode = patchedCode.replace(/\breturn(false|true|null|undefined)\b/g, "return $1");
        if (IS_DEV) {
            patchedSource = `// Webpack Module ${moduleIdStr} - Patched by ${[...patchedBy].join(", ")}\n${fixedCode}\n//# sourceURL=file:///WebpackModule${moduleIdStr}`;
        } else {
            patchedSource = `${fixedCode}\n//# sourceURL=file:///WebpackModule${moduleIdStr}`;
        }

        // This has to stay inside the same failure handling the per-replacement eval had.
        // A replacement can produce code that no longer parses - that is exactly what a
        // patch whose `find` matched but whose `match` matched the wrong shape looks like -
        // and while the eval was per replacement that SyntaxError was caught below, logged
        // against the plugin that caused it, and the module still loaded. Hoisting the eval
        // out of the loop put it on the factory path, where a SyntaxError propagates out of
        // `patchFactory`, so the module never loads and every flux handler and component it
        // exports is gone: React unmounts the tree, and the crash handler immediately
        // navigates to @me. The freeze was this throwing, repeatedly, on channel switches.
        //
        // Falling back to the unpatched factory is what a `noModule` looks like to webpack,
        // so the module loads and only the one plugin's effect is missing.
        try {
            patchedFactory = (0, eval)(patchedSource);
        } catch (err) {
            const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
            const recovered = dropSyntaxOffenders(originalPatchedCode, moduleIdStr);

            for (const offender of recovered?.offenders ?? []) {
                logger.error(
                    `Patch by ${offender.plugin} broke module ${moduleIdStr} and was skipped: `
                    + `${offender.find} / ${offender.match}\n${error}`,
                    IS_DEV ? patchedSource : undefined
                );
                PluginHealth.recordPatchFailure(offender.plugin, {
                    kind: "errored",
                    find: offender.find,
                    match: String(offender.match),
                    moduleId: moduleIdStr,
                    error
                });
            }

            if (!recovered) {
                logger.error(
                    `Patched code for module ${moduleIdStr} did not parse and no subset could be `
                    + `recovered, reverting every patch on it (applied by: ${[...patchedBy].join(", ") || "unknown"}). `
                    + error,
                    IS_DEV ? patchedSource : undefined
                );
                patchedFactory = originalFactory;
                patchedSource = patchedCode;
            } else {
                patchedSource = IS_DEV
                    ? `// Webpack Module ${moduleIdStr} - Patched by ${[...patchedBy].join(", ")}, `
                        + `minus ${recovered.offenders.map(o => o.plugin).join(", ")}\n${recovered.code}`
                        + `\n//# sourceURL=file:///WebpackModule${moduleIdStr}`
                    : `${recovered.code}\n//# sourceURL=file:///WebpackModule${moduleIdStr}`;
                patchedFactory = (0, eval)(patchedSource);
            }
        }
    }

    if (patchedFactory !== originalFactory) {
        patchedModuleIds.add(moduleId);
    }

    patchedFactory[SYM_ORIGINAL_FACTORY] = originalFactory;

    if (IS_DEV && patchedFactory !== originalFactory) {
        originalFactory[SYM_PATCHED_SOURCE] = patchedSource;
        originalFactory[SYM_PATCHED_BY] = patchedBy;
    }

    return patchedFactory as PatchedModuleFactory;
}

function diffErroredPatch(code: string, lastCode: string, match: RegExpMatchArray) {
    const changeSize = code.length - lastCode.length;

    const matchIndex = match?.index ?? 0;
    const matchLength = match?.[0]?.length ?? 0;

    // Use 200 surrounding characters of context
    const start = Math.max(0, matchIndex - 200);
    const end = Math.min(lastCode.length, matchIndex + matchLength + 200);
    // (changeSize may be negative)
    const endPatched = end + changeSize;

    const context = lastCode.slice(start, end);
    const patchedContext = code.slice(start, endPatched);

    // Inline require to avoid including it in !IS_DEV builds
    const diff = (require("diff") as typeof import("diff")).diffWordsWithSpace(context, patchedContext);
    let fmt = "%c %s ";
    const elements: string[] = [];
    for (const d of diff) {
        const color = d.removed
            ? "red"
            : d.added
                ? "lime"
                : "grey";
        fmt += "%c%s";
        elements.push("color:" + color, d.value);
    }

    logger.errorCustomFmt(...Logger.makeTitle("white", "Before"), context);
    logger.errorCustomFmt(...Logger.makeTitle("white", "After"), patchedContext);
    const [titleFmt, ...titleElements] = Logger.makeTitle("white", "Diff");
    logger.errorCustomFmt(titleFmt + fmt, ...titleElements, ...elements);
}

function getPatchContext(code: string, find: string | RegExp) {
    let index = typeof find === "string" ? code.indexOf(find) : code.search(find);
    if (index < 0) index = 0;
    return code.slice(Math.max(0, index - 300), Math.min(code.length, index + 700));
}
