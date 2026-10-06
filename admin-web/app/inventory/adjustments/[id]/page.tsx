'use client'
import { useParams } from 'next/navigation'
import { Suspense } from 'react'
import AdjustmentDocument from '@/components/inventory/AdjustmentDocument'

export default function AdjustmentPage() {
  const { id } = useParams<{ id: string }>()
  return <Suspense><AdjustmentDocument id={id} /></Suspense>
}
