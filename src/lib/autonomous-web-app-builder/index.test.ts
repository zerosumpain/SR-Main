import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildWebApp } from './index';
import type { WebAppSpec } from './index';

// Mock the platform object
const mockPlatformCall = vi.fn();
vi.mock('$lib/platform', () => ({
  platform: {
    call: mockPlatformCall,
  },
}));

describe('buildWebApp', () => {
  beforeEach(() => {
    mockPlatformCall.mockReset();
  });

  it('should call the correct sequence of platform tools for a static app', async () => {
    const spec: WebAppSpec = {
      title: 'Test App',
      description: 'A simple test',
      type: 'static',
    };

    // Simulate successful calls
    mockPlatformCall.mockResolvedValue(undefined);

    const result = await buildWebApp(spec);

    expect(result.success).toBe(true);
    expect(result.url).toBe('/apps/test-app');

    // Verify call order and arguments
    expect(mockPlatformCall).toHaveBeenCalledTimes(5);

    // 1. write_files
    expect(mockPlatformCall).toHaveBeenNthCalledWith(1, 'node_builder_write_files', {
      files: [
        { path: 'index.html', content: expect.stringContaining('<h1>Test App</h1>') },
        { path: 'styles.css', content: expect.stringContaining('body') },
        { path: 'app.js', content: expect.stringContaining('Test App loaded') },
      ],
    });

    // 2. validate
    expect(mockPlatformCall).toHaveBeenNthCalledWith(2, 'node_builder_validate', {});

    // 3. commit_and_deploy
    expect(mockPlatformCall).toHaveBeenNthCalledWith(3, 'node_builder_commit_and_deploy', {
      message: 'Autonomous build: Test App',
    });

    // 4. studio_build
    expect(mockPlatformCall).toHaveBeenNthCalledWith(4, 'studio_build', {});

    // 5. publish_page
    expect(mockPlatformCall).toHaveBeenNthCalledWith(5, 'publish_page', {
      path: '/apps/test-app',
    });
  });

  it('should handle errors gracefully', async () => {
    const spec: WebAppSpec = {
      title: 'Failing App',
      description: 'This will fail',
      type: 'static',
    };

    mockPlatformCall.mockRejectedValueOnce(new Error('write failed'));

    const result = await buildWebApp(spec);

    expect(result.success).toBe(false);
    expect(result.error).toBe('write failed');
    expect(mockPlatformCall).toHaveBeenCalledTimes(1);
  });

  it('should accept custom HTML/CSS/JS', async () => {
    const spec: WebAppSpec = {
      title: 'Custom',
      description: 'Custom content',
      type: 'static',
      customHtml: '<div>Custom</div>',
      customCss: 'div { color: red; }',
      customJs: 'alert(1);',
    };

    mockPlatformCall.mockResolvedValue(undefined);

    const result = await buildWebApp(spec);

    expect(result.success).toBe(true);
    expect(mockPlatformCall).toHaveBeenNthCalledWith(1, 'node_builder_write_files', {
      files: [
        { path: 'index.html', content: '<div>Custom</div>' },
        { path: 'styles.css', content: 'div { color: red; }' },
        { path: 'app.js', content: 'alert(1);' },
      ],
    });
  });
});
