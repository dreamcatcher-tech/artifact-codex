in the face-inspector project, if I start the web-server project and then start
a face-inspector face, it tries to start one of its services on port 10000, but
this should always be in use by the system face that is running the web-server
itself. face-inspector should use port selection logic and probing checks the
same as the other projects do.

update the AGENTS.md file to note how the project is intended to be used, where
web-server runs, and then based on interactions with the user, an LLM calls the
mcp tools that are supplied as a default, to create further agents and faces,
and interact with them.

for each deno project, remove every entry from its imports, and in the workspace
root, add the import there. Each project in the workspace should have nothing in
the imports field of its deno.json, as they should all be in one spot - in the
deno.json of the workspace root.

the ports logic in @shared/ports.ts is not making use of the imports from
port-free. functions that are not leveraging this library maximally are:
isPortListening, findAvailablePort

I don't like this code:

```ts
const TEMPLATE_REWRITES: Record<string, string> = {
  '/headers/mcp-computers/main.ts': join(REPO_ROOT, 'mcp-computers', 'main.ts'),
  '/headers/mcp-agents/main.ts': join(REPO_ROOT, 'mcp-agents', 'main.ts'),
  '/headers/mcp-faces/main.ts': join(REPO_ROOT, 'mcp-faces', 'main.ts'),
  '/headers/mcp-interactions/main.ts': join(
    REPO_ROOT,
    'mcp-interactions',
    'main.ts',
  ),
}
```

What it should do, is use import.meta.url and other types of sniffing to figure
out the path of the files at runtime. How this project will be deployed, is that
the whole workspace will be copied over, and then run from there, so the files
will always be available in the same relative path, but finding the absolute
path needs to be done at runtime, rather than rewriting the template.
