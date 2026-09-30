import type { Plan } from '@prisma/client';

/** A plan as the pricing page and the platform console see it. */
export function toPlanView(plan: Plan) {
  return {
    id: plan.id,
    code: plan.code,
    name_ar: plan.name_ar,
    name_en: plan.name_en,
    description: plan.description,
    price_monthly: Number(plan.price_monthly),
    currency: plan.currency,
    limits: plan.limits,
    features: plan.features,
    is_public: plan.is_public,
    is_active: plan.is_active,
    sort_order: plan.sort_order,
  };
}
