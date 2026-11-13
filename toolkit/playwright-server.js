// Opt-in isolated server ownership for concurrent worktree verification.
export function testServer(preview = false) {
  const selected = process.env.INTERSECT_TEST_PORT;
  const port = selected === undefined ? (preview ? 4180 : 4173) : Number(selected);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('INTERSECT_TEST_PORT must be an integer from 1 through 65535');
  }
  const baseURL = `http://127.0.0.1:${port}`;
  return {
    baseURL,
    webServer: {
      command: `node node_modules/vite/bin/vite.js ${preview ? 'preview ' : ''}--host 127.0.0.1 --port ${port} --strictPort`,
      url: baseURL,
      reuseExistingServer: selected === undefined && !process.env.CI,
      timeout: 30000,
    },
  };
}
