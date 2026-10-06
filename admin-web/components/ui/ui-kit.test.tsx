import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ConfirmDialog from './ConfirmDialog'
import Num from './Num'
import NumberInput from './NumberInput'
import ProgressBar from './ProgressBar'
import Stepper from './Stepper'

describe('Num', () => {
  it('renders money with the unit and a real minus, LTR', () => {
    const { container } = render(<Num value={-1250} kind="money" />)
    const el = container.querySelector('bdi')!
    expect(el).toHaveTextContent('−1,250.00 ج.م')
    expect(el).toHaveAttribute('dir', 'ltr')
  })
  it('signs deltas', () => {
    render(<Num value={5} kind="qty" signed />)
    expect(screen.getByText('+5')).toBeInTheDocument()
  })
})

describe('NumberInput', () => {
  it('converts Arabic digits and refuses extra decimals', () => {
    const onChange = vi.fn()
    render(<NumberInput value="" onChange={onChange} precision={0} ariaLabel="الكمية" />)
    fireEvent.change(screen.getByLabelText('الكمية'), { target: { value: '٣٫٥' } })
    expect(onChange).toHaveBeenCalledWith('35')
  })
})

describe('ConfirmDialog', () => {
  it('focuses cancel for danger, closes on Escape and gates confirm on the checkbox', () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    render(<ConfirmDialog open title="ترحيل" confirmLabel="ترحيل" tone="danger" requireCheck="أؤكد" onConfirm={onConfirm} onClose={onClose}>نص</ConfirmDialog>)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'رجوع' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'ترحيل' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'ترحيل' }))
    expect(onConfirm).toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
  it('renders nothing when closed', () => {
    render(<ConfirmDialog open={false} title="x" confirmLabel="y" onConfirm={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('ProgressBar / Stepper', () => {
  it('is indeterminate without a value', () => {
    render(<ProgressBar label="تقدم" />)
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
  })
  it('marks the current step', () => {
    render(<Stepper steps={[{ key: 'a', label: 'أ' }, { key: 'b', label: 'ب' }]} current={1} />)
    expect(screen.getByText('ب').closest('li')).toHaveAttribute('aria-current', 'step')
  })
})
