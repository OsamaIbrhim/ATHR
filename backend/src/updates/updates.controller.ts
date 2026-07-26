import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { readPosCompatibilityManifest } from './pos-compatibility';
import {
  PosUpdateManifestResolver,
  readPosUpdateManifest,
} from './pos-update-manifest';

export { readPosUpdateManifest };
export type { PosUpdateManifest } from './pos-update-manifest';

const updateManifestResolver = new PosUpdateManifestResolver();

@Controller('pos-updates')
export class UpdatesController {
  @Public()
  @Get('latest')
  latest() {
    return updateManifestResolver.resolve();
  }
}

@Controller('pos')
export class PosCompatibilityController {
  @Public()
  @Get('compatibility')
  compatibility() {
    return readPosCompatibilityManifest();
  }
}
