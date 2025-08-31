export default {
  // Serve docs from the design folder
  srcDir: 'design',
  title: 'Agents Docs',
  description: 'SSH-first multi-agent docs',
  cleanUrls: true,
  themeConfig: {
    search: { provider: 'local' },
    outline: 'deep',
  },
  markdown: {
    lineNumbers: true,
  },
};

