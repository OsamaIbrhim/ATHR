import { readFileSync } from 'fs';
import * as path from 'path';

function repositoryFile(relativePath: string) {
  return readFileSync(
    path.resolve(process.cwd(), '..', relativePath),
    'utf8',
  );
}

describe('ATHR identity and deployment contract', () => {
  it('does not ship a hard-coded production API or the legacy API variable', () => {
    const main = repositoryFile('pos-electron/electron/main.ts');
    expect(main).not.toContain('boldsystem-production.up.railway.app');
    expect(main).not.toContain('BOLD_API_URL');
    expect(main).toContain('ATHR_API_URL');
  });

  it('publishes ATHR package and installer identities', () => {
    const backend = JSON.parse(repositoryFile('backend/package.json'));
    const admin = JSON.parse(repositoryFile('admin-web/package.json'));
    const pos = JSON.parse(repositoryFile('pos-electron/package.json'));
    expect(backend.name).toBe('athr-operations-api');
    expect(admin.name).toBe('athr-operations-admin');
    expect(pos.name).toBe('athr-pos-electron');
    expect(pos.build).toMatchObject({
      appId: 'com.athr.operations.pos',
      productName: 'ATHR POS',
      artifactName: 'ATHR-POS-Setup-${version}.${ext}',
    });
  });

  it('keeps customer-visible application shells free of the legacy brand', () => {
    const visibleFiles = [
      'admin-web/app/layout.tsx',
      'admin-web/app/page.tsx',
      'admin-web/app/login/page.tsx',
      'admin-web/components/ui/Sidebar.tsx',
      'pos-electron/index.html',
      'pos-electron/src/components/ui.tsx',
      'pos-electron/src/screens/EnrollmentScreen.tsx',
      'pos-electron/src/screens/RegisterScreen.tsx',
      'pos-electron/src/screens/SalesScreen.tsx',
    ];
    for (const filename of visibleFiles) {
      expect(repositoryFile(filename)).not.toMatch(/\bBold\b|بولد/);
    }
  });
});
