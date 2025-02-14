import type { PluginOption } from 'vite';
import type { FinalMonkeyOption, PkgOptions } from '../types';
import { getModuleRealInfo, miniCode } from '../_util';
import { lookup, mimes } from 'mrmime';
import { URLSearchParams } from 'node:url';

// word come form https://github.com/vitejs/vite/blob/caf00c8c7a5c81a92182116ffa344b34ce4c3b5e/packages/vite/src/node/constants.ts#L91
const KNOWN_ASSET_TYPES = new Set([
  // images
  'png',
  'jpg',
  'jpeg',
  'jfif',
  'pjpeg',
  'pjp',
  'gif',
  'svg',
  'ico',
  'webp',
  'avif',

  // media
  'mp4',
  'webm',
  'ogg',
  'mp3',
  'wav',
  'flac',
  'aac',

  // fonts
  'woff',
  'woff2',
  'eot',
  'ttf',
  'otf',

  // other
  'webmanifest',
  'pdf',
  'txt',
]);

export default (finalPluginOption: FinalMonkeyOption): PluginOption => {
  const addGant = (
    ...args: Array<'GM_getResourceURL' | 'GM_getResourceText' | 'GM_addStyle'>
  ) => {
    const { grant = [] } = finalPluginOption.userscript;
    if (grant instanceof Array) {
      grant.push(...args);
      finalPluginOption.userscript.grant = grant;
    } else if (grant != '*' && grant != 'none') {
      finalPluginOption.userscript.grant = [grant, ...args];
    }
  };
  return {
    name: 'monkey:externalResource',
    enforce: 'pre',
    apply: 'build',
    async resolveId(id) {
      const { externalResource } = finalPluginOption.build;
      if (id in externalResource) {
        return '\0' + id + '\0';
      }
      // see https://github.com/vitejs/vite/blob/5d56e421625b408879672a1dd4e774bae3df674f/packages/vite/src/node/plugins/css.ts#L431-L434
      const id2 = id.replace('.css?used&', '.css?');
      if (id2 in externalResource) {
        return '\0' + id2 + '\0';
      }
    },
    async load(id) {
      if (id[0] === '\0' && id[id.length - 1] === '\0') {
        const { externalResource } = finalPluginOption.build;
        const importName = id.substring(1, id.length - 1);
        if (!(importName in externalResource)) {
          return;
        }
        const pkg = await getModuleRealInfo(importName);
        const {
          resourceName: resourceNameFn,
          resourceUrl: resourceUrlFn,
          loader,
          nodeLoader,
        } = externalResource[importName];
        const resourceName = await resourceNameFn({ ...pkg, importName });
        const resourceUrl = await resourceUrlFn({ ...pkg, importName });
        const { resource = {} } = finalPluginOption.userscript;
        resource[resourceName] = resourceUrl;
        finalPluginOption.userscript.resource = resource;

        if (nodeLoader) {
          return miniCode(
            await nodeLoader({
              ...pkg,
              resourceName,
              resourceUrl,
              importName,
            }),
          );
        } else if (loader) {
          let fnText: string;
          if (
            loader.prototype && // not arrow function
            loader.name.length > 0 &&
            loader.name != 'function' // not anonymous function
          ) {
            if (Reflect.get(loader, Symbol.toStringTag) == 'AsyncFunction') {
              fnText = loader
                .toString()
                .replace(/^[\s\S]+?\(/, 'async function(');
            } else {
              fnText = loader.toString().replace(/^[\s\S]+?\(/, 'function(');
            }
          } else {
            fnText = loader.toString();
          }
          return miniCode(
            `export default (${fnText})(${JSON.stringify({
              resourceUrl,
              importName,
              ...pkg,
            } as PkgOptions)})`,
          );
        }

        let moduleCode: string | undefined = undefined;
        const ext = importName.split('?')[0].split('.').pop()!;
        const mimeType = lookup(ext) ?? 'application/octet-stream';
        const suffixSet = new URLSearchParams(importName.split('?').pop());
        if (suffixSet.has('url') || suffixSet.has('inline')) {
          moduleCode = [
            `import {urlLoader as loader} from 'virtual:plugin-monkey-loader'`,
            `export default loader(...${JSON.stringify([
              resourceName,
              mimeType,
            ])})`,
          ].join(';');
        } else if (suffixSet.has('raw')) {
          moduleCode = [
            `import {rawLoader as loader} from 'virtual:plugin-monkey-loader'`,
            `export default loader(...${JSON.stringify([resourceName])})`,
          ].join(';');
        } else if (ext == 'json') {
          // export name will bring side effect
          moduleCode = [
            `import {jsonLoader as loader} from 'virtual:plugin-monkey-loader'`,
            `export default loader(...${JSON.stringify([resourceName])})`,
          ].join(';');
        } else if (ext == 'css') {
          moduleCode = [
            `import {cssLoader as loader} from 'virtual:plugin-monkey-loader'`,
            `export default loader(...${JSON.stringify([resourceName])})`,
          ].join(';');
        } else if (KNOWN_ASSET_TYPES.has(ext)) {
          const mediaType = mimes[ext];
          moduleCode = [
            `import {urlLoader as loader} from 'virtual:plugin-monkey-loader'`,
            `export default loader(...${JSON.stringify([
              resourceName,
              mediaType,
            ])})`,
          ].join(';');
        }
        if (moduleCode) {
          if (
            moduleCode.includes('rawLoader') ||
            moduleCode.includes('jsonLoader')
          ) {
            addGant('GM_getResourceText');
          } else if (moduleCode.includes('urlLoader')) {
            addGant('GM_getResourceURL');
          } else if (moduleCode.includes('cssLoader')) {
            addGant('GM_addStyle', 'GM_getResourceText');
          }
          return miniCode(moduleCode);
        }

        throw new Error(`module: ${importName} not found loader`);
      }
    },
  };
};
