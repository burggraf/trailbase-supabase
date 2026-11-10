import {afterEach,expect,it,vi} from 'vitest';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import * as tools from '../../scripts/tools.mjs';

afterEach(()=>vi.unstubAllEnvs());

it('L1-27/U27 unit runner environment defaults absent TMPDIR without mutating its parent',()=>{
 vi.stubEnv('TMPDIR',undefined);
 vi.stubEnv('UNIT_ENV_SENTINEL','inert-unit-marker');
 const child: NodeJS.ProcessEnv | undefined=tools.unitTestEnvironment?.();
 expect(child?.TMPDIR).toBe(tmpdir());
 expect(isAbsolute(child?.TMPDIR ?? '')).toBe(true);
 expect(child?.UNIT_ENV_SENTINEL).toBe('inert-unit-marker');
 expect(process.env.TMPDIR).toBeUndefined();
 expect(child).not.toBe(process.env);
});

it('L1-27/U27 unit runner environment preserves the explicitly supplied temporary parent',()=>{
 const supplied=join(tmpdir(),'inert-unit-parent');
 vi.stubEnv('TMPDIR',supplied);
 const child: NodeJS.ProcessEnv | undefined=tools.unitTestEnvironment?.();
 expect(child?.TMPDIR).toBe(supplied);
 expect(process.env.TMPDIR).toBe(supplied);
});
