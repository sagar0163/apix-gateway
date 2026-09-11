import fs from 'fs';
import path from 'path';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function success(msg) { console.log(`${c.green}✔${c.reset} ${msg}`); }
function error(msg) { console.error(`${c.red}✖${c.reset} ${msg}`); process.exit(1); }

export function cmdCreatePlugin(name) {
  if (!name) {
    error('Plugin name is required. Usage: apix create-plugin <name>');
  }

  const pluginDir = path.resolve(process.cwd(), name);
  if (fs.existsSync(pluginDir)) {
    error(`Directory ${name} already exists`);
  }

  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(path.join(pluginDir, 'src'));
  fs.mkdirSync(path.join(pluginDir, 'test'));

  // package.json
  const pkg = {
    name: `apix-plugin-${name}`,
    version: '1.0.0',
    description: `Apix Gateway plugin: ${name}`,
    type: 'module',
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
    scripts: {
      "build": "tsc",
      "test": "vitest run"
    },
    dependencies: {
      "@apix/plugin-sdk": "latest"
    },
    devDependencies: {
      "typescript": "^5.0.0",
      "vitest": "^2.0.0",
      "@types/node": "^20.0.0",
      "@types/express": "^4.17.21"
    }
  };
  fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  // tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      declaration: true,
      outDir: "./dist",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true
    },
    include: ["src/**/*"]
  };
  fs.writeFileSync(path.join(pluginDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n');

  // src/index.ts
  const indexTs = `import { ApixPlugin, ApixRequest, ApixResponse, ApixNextFunction } from '@apix/plugin-sdk';

export interface ${name.charAt(0).toUpperCase() + name.slice(1).replace(/-./g, x=>x[1].toUpperCase())}Options {
  headerName?: string;
  headerValue?: string;
}

const plugin: ApixPlugin = {
  name: '${name}',
  version: '1.0.0',
  defaultOptions: {
    headerName: 'X-Plugin-Status',
    headerValue: 'Active'
  },
  handler: async (req: ApixRequest, res: ApixResponse, next: ApixNextFunction) => {
    const options = req._pluginOptions?.['${name}'] || plugin.defaultOptions;
    res.setHeader(options.headerName, options.headerValue);
    next();
  }
};

export default plugin;
`;
  fs.writeFileSync(path.join(pluginDir, 'src', 'index.ts'), indexTs);

  // test/index.test.ts
  const testTs = `import { describe, it, expect, vi } from 'vitest';
import plugin from '../src/index.js';
import { ApixRequest, ApixResponse, ApixNextFunction } from '@apix/plugin-sdk';

describe('${name} plugin', () => {
  it('should set the configured header', async () => {
    const req = { _pluginOptions: { '${name}': { headerName: 'X-Test', headerValue: 'ok' } } } as unknown as ApixRequest;
    const res = { setHeader: vi.fn() } as unknown as ApixResponse;
    const next = vi.fn() as unknown as ApixNextFunction;

    await plugin.handler!(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Test', 'ok');
    expect(next).toHaveBeenCalled();
  });
});
`;
  fs.writeFileSync(path.join(pluginDir, 'test', 'index.test.ts'), testTs);

  success(`Created plugin scaffold in ${pluginDir}`);
  console.log(`
  Next steps:
    cd ${name}
    npm install
    npm run build
    npm test
`);
}
