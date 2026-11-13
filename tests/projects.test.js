import assert from 'node:assert/strict';
import test from 'node:test';
import { presentProject } from '../routes/projects.js';

test('project responses use stored banner and live URLs without deriving GitHub links', () => {
  const manualProject = presentProject({
    id: 12,
    title: 'Portfolio',
    description: 'A manually added project.',
    banner: 'https://res.cloudinary.com/demo/image/upload/banner.webp',
    live_link: 'https://example.com',
    repo: 'old-repo-value',
  });
  const oldProject = presentProject({ repo: 'legacy-repo' });

  assert.equal(manualProject.image, 'https://res.cloudinary.com/demo/image/upload/banner.webp');
  assert.equal(manualProject.link, 'https://example.com');
  assert.equal(oldProject.image, null);
  assert.equal(oldProject.link, null);
  assert.equal('repo' in manualProject, false);
});
