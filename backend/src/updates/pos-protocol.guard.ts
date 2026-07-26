import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  HttpException,
} from '@nestjs/common';
import { Request } from 'express';
import {
  comparePosVersions,
  readPosCompatibilityManifest,
} from './pos-compatibility';

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value)
    ? String(value[0] || '').trim()
    : String(value || '').trim();
}

export class PosProtocolGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const manifest = readPosCompatibilityManifest();
    const rawProtocol = headerValue(request.headers['x-pos-protocol-version']);
    const appVersion = headerValue(request.headers['x-pos-app-version']);

    // Staged rollout: legacy tills remain accepted until every installation has
    // upgraded. Explicit malformed or unsupported headers still fail closed.
    if (!rawProtocol || !appVersion) {
      if (!manifest.require_protocol_headers) return true;
      throw new HttpException({
        code: 'POS_PROTOCOL_HEADER_REQUIRED',
        retryable: false,
        message_ar:
          'نسخة نقطة البيع قديمة ولا ترسل بيانات التوافق المطلوبة. حدّث التطبيق قبل المتابعة.',
        message:
          'This POS build does not send the required compatibility headers.',
        compatibility: manifest,
      }, 426);
    }

    const protocol = Number(rawProtocol);
    if (
      !Number.isSafeInteger(protocol) ||
      protocol < manifest.api_protocol.minimum ||
      protocol > manifest.api_protocol.maximum
    ) {
      throw new ConflictException({
        code: 'POS_PROTOCOL_UNSUPPORTED',
        retryable: false,
        message_ar:
          'نسخة نقطة البيع غير متوافقة مع نسخة الخادم الحالية. أوقف المزامنة وحدّث التطبيق أو الخادم.',
        message: 'The POS protocol is not supported by this backend deployment.',
        received_protocol: rawProtocol,
        compatibility: manifest,
      });
    }

    let appTooOld = false;
    try {
      appTooOld = comparePosVersions(
        appVersion,
        manifest.minimum_pos_version,
      ) < 0;
    } catch {
      appTooOld = true;
    }
    if (appTooOld) {
      throw new HttpException({
        code: 'POS_UPDATE_REQUIRED',
        retryable: false,
        message_ar:
          `إصدار نقطة البيع ${appVersion || 'غير معروف'} أقدم من الحد الأدنى ${manifest.minimum_pos_version}.`,
        message: 'The POS application must be upgraded before this operation.',
        received_app_version: appVersion || null,
        compatibility: manifest,
      }, 426);
    }

    return true;
  }
}
