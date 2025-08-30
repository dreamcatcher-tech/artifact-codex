import DefaultTheme from 'vitepress/theme';
import { nextTick } from 'vue';
import { createMermaidRenderer } from 'vitepress-mermaid-renderer';
import 'vitepress-mermaid-renderer/dist/style.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ router }) {
    const mr = createMermaidRenderer({
      // You can tweak Mermaid options here if desired
      mermaidConfig: { startOnLoad: false }
    });

    // Initial render after first mount
    if (typeof window !== 'undefined') {
      nextTick(() => mr.renderMermaidDiagrams());
    }

    // Re-render on route changes
    if (router && router.onAfterRouteChange) {
      router.onAfterRouteChange = () => {
        nextTick(() => mr.renderMermaidDiagrams());
      };
    }
  }
};

