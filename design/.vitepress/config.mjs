export default {
  // Use repo root as source so all Markdown renders.
  srcDir: '.',
  title: 'Agents Docs',
  description: 'SSH-first multi-agent docs',
  cleanUrls: true,
  themeConfig: {
    // Built-in local search (no external service)
    search: { provider: 'local' },
    outline: 'deep'
  },
  markdown: {
    lineNumbers: true
  }
};

