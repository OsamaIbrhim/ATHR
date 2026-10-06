'use client'
import { Suspense } from 'react'
import AdjustmentDocument from '@/components/inventory/AdjustmentDocument'

export default function NewAdjustmentPage() {
  return <Suspense><AdjustmentDocument id={null} /></Suspense>
}
