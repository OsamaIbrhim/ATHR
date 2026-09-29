'use client'
import { useEffect, useState } from 'react'
import { ApiError, apiGet } from '@/lib/api'
import type { ProductType, Uom } from '@/lib/catalog/types'

/** Product types and units of measure the form picks from. Units need their own permission: a 403 just hides the picker. */
export function useCatalogRefs() {
  const [types, setTypes] = useState<ProductType[]>([])
  const [uoms, setUoms] = useState<Uom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiGet('/product-types'),
      apiGet('/uom').catch(e => (e instanceof ApiError && e.code !== 'NETWORK_ERROR' ? [] : Promise.reject(e))),
    ])
      .then(([typeRows, uomRows]) => {
        if (cancelled) return
        setTypes(typeRows)
        setUoms((uomRows as Uom[]).filter(uom => uom.is_active))
      })
      .catch((e: any) => { if (!cancelled) setError(e.message || 'تعذر تحميل أنواع المنتجات') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { types, uoms, loading, error }
}
