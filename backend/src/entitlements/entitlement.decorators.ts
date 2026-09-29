import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from './catalog';

export const REQUIRED_FEATURE_KEY = 'athr:required-feature';
export const ANY_ACCESS_MODE_KEY = 'athr:any-access-mode';
export const PLATFORM_ROUTE_KEY = 'athr:platform-route';

/** The route needs a plan feature (class- or handler-level; the handler wins). */
export const RequireFeature = (feature: FeatureKey) => SetMetadata(REQUIRED_FEATURE_KEY, feature);

/**
 * The route stays reachable in every access mode, including read-only and
 * suspended: session endpoints, the subscription status, the POS heartbeat.
 */
export const AllowInAnyAccessMode = () => SetMetadata(ANY_ACCESS_MODE_KEY, true);
