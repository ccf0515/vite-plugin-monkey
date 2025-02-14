import type { PluginOption, ResolvedConfig } from 'vite';
import { cssInjectTemplate, template2string } from '../inject_template';
import type { FinalMonkeyOption } from '../types';
import { userscript2comment } from '../userscript';
import { miniCode } from '../_util';
import selfPkg from '../../../package.json';

const timeTagCode = () =>
  `// use ${selfPkg.name}@${selfPkg.version} at ${new Date().toISOString()}`;

export default (finalPluginOption: FinalMonkeyOption): PluginOption => {
  let viteConfig: ResolvedConfig;
  return {
    name: 'monkey:extraToBundle',
    apply: 'build',
    enforce: 'post',
    async configResolved(resolvedConfig) {
      viteConfig = resolvedConfig;
    },
    async generateBundle(_, bundle) {
      const bundleList = Object.entries(bundle);
      const cssBundleList = bundleList.filter(([k]) => k.endsWith('.css'));
      const jsBundleList = bundleList.filter(([k]) => k.endsWith('.js'));
      const cssList: string[] = [];
      cssBundleList.forEach(([k, v]) => {
        if (v.type == 'asset') {
          cssList.push(v.source.toString());
          delete bundle[k];
        }
      });
      let injectCssCode: undefined | string = undefined;
      if (cssList.length > 0) {
        let css = cssList.join('');
        if (!viteConfig.build.minify && finalPluginOption.build.minifyCss) {
          css = await miniCode(css, 'css');
        }
        injectCssCode = await miniCode(
          template2string(cssInjectTemplate, {
            css,
          }),
          'js',
        );
      }
      const chunk = jsBundleList[0][1];
      if (chunk.type == 'chunk') {
        chunk.code = [
          await userscript2comment(
            finalPluginOption.userscript,
            finalPluginOption.format,
          ),
          timeTagCode(),
          injectCssCode,
          chunk.code,
        ]
          .filter((s) => s)
          .join('\n\n');
      }

      let { metaFileName } = finalPluginOption.build;
      if (metaFileName === true) {
        metaFileName = finalPluginOption.build.fileName.replace(
          /\.user\.js$/,
          '.meta.js',
        );
      }
      if (typeof metaFileName == 'string' && metaFileName.length > 0) {
        this.emitFile({
          type: 'asset',
          fileName: metaFileName,
          source: await userscript2comment(
            finalPluginOption.userscript,
            finalPluginOption.format,
          ),
        });
      }
    },
  };
};
