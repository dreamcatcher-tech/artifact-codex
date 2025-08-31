import DefaultTheme from 'vitepress/theme';
import { inBrowser, onContentUpdated } from 'vitepress';
import { createMermaidRenderer } from 'vitepress-mermaid-renderer';
import 'vitepress-mermaid-renderer/dist/style.css';

/** @type {import('vitepress').Theme} */
export default {
  extends: DefaultTheme,
  enhanceApp({ router }) {
    if (!inBrowser) return;

    const mr = createMermaidRenderer({
      mermaidConfig: { startOnLoad: false },
    });

    mr.initialize?.();
    onContentUpdated(() => mr.renderMermaidDiagrams());

    router.onAfterRouteChange = () => {
      mr.renderMermaidDiagrams();
    };
  },
};

