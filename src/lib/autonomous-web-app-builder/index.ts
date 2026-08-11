import { platform } from '$lib/platform'; // Assume platform.call is available

// ---------------------------------------------------------------------------
// Types for the inputs and outputs of the platform tools we orchestrate
// ---------------------------------------------------------------------------

interface NodeBuilderFile {
  path: string;
  content: string;
}

interface NodeBuilderWriteFilesArgs {
  files: NodeBuilderFile[];
  basePath?: string; // optional, defaults to project root
}

interface NodeBuilderCommitAndDeployArgs {
  message: string;
}

interface StudioBuildArgs {
  projectPath?: string;
}

interface PublishPageArgs {
  path: string;
}

// ---------------------------------------------------------------------------
// Spec for the web app to build
// ---------------------------------------------------------------------------

export interface WebAppSpec {
  title: string;
  description: string;
  /**
   * 'static' – a simple HTML/CSS/JS site
   * 'nodejs' – a Node.js/Express app (not yet implemented)
   * 'react' – a React SPA (not yet implemented)
   */
  type: 'static';
  /** Additional custom content (optional) */
  customHtml?: string;
  customCss?: string;
  customJs?: string;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface BuildResult {
  success: boolean;
  url?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Generate a set of files for a simple static web app.
 */
function generateStaticFiles(spec: WebAppSpec): NodeBuilderFile[] {
  const title = spec.title || 'Untitled App';
  const description = spec.description || '';
  const html = spec.customHtml || `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <h1>${title}</h1>
  <p>${description}</p>
  <script src="/app.js"></script>
</body>
</html>
`.trim();

  const css = spec.customCss || `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; }
h1 { color: #333; }
p { margin-top: 1rem; color: #666; }
`.trim();

  const js = spec.customJs || `
console.log('${title} loaded');
`.trim();

  return [
    { path: 'index.html', content: html },
    { path: 'styles.css', content: css },
    { path: 'app.js', content: js },
  ];
}

/**
 * Orchestrate the build pipeline:
 * 1. Write files via node_builder_write_files
 * 2. Validate via node_builder_validate
 * 3. Commit and deploy via node_builder_commit_and_deploy
 * 4. Build via studio_build
 * 5. Publish via publish_page
 */
export async function buildWebApp(spec: WebAppSpec): Promise<BuildResult> {
  try {
    // 1. Generate files
    const files = generateStaticFiles(spec);
    const writeArgs: NodeBuilderWriteFilesArgs = { files };
    await platform.call('node_builder_write_files', writeArgs);

    // 2. Validate
    await platform.call('node_builder_validate', {});

    // 3. Commit and deploy
    const commitArgs: NodeBuilderCommitAndDeployArgs = {
      message: `Autonomous build: ${spec.title}`,
    };
    await platform.call('node_builder_commit_and_deploy', commitArgs);

    // 4. Studio build
    await platform.call('studio_build', {});

    // 5. Publish page – assume the files are published to a path derived from title
    const pagePath = `/apps/${spec.title.toLowerCase().replace(/\s+/g, '-')}`;
    const publishArgs: PublishPageArgs = { path: pagePath };
    await platform.call('publish_page', publishArgs);

    return {
      success: true,
      url: pagePath,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
    };
  }
}
