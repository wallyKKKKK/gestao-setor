'use client'

import { useEffect, useRef } from 'react'

const FOCUSED_ROW_CLASS = 'wally-table-focused-row'
const FOCUSED_CELL_CLASS = 'wally-table-focused-cell'

function isInteractiveElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('button, a, input, textarea, select, [contenteditable="true"], [role="button"], [role="switch"], [role="checkbox"]'))
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}

function getFocusableRow(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return null
  const row = target.closest('tbody tr') as HTMLTableRowElement | null
  if (!row) return null
  const table = row.closest('table')
  if (!table || table.dataset.disableRowFocus === 'true') return null
  if (!isFocusableRow(row)) return null
  return row
}

function isFocusableRow(row: HTMLTableRowElement) {
  if (!row.isConnected) return false
  if (!row.closest('tbody')) return false
  if (row.cells.length === 0) return false
  if (row.cells.length === 1 && row.cells[0]?.hasAttribute('colspan')) return false

  const style = window.getComputedStyle(row)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function getVisibleRows(tbody: HTMLTableSectionElement) {
  return Array.from(tbody.rows).filter(isFocusableRow)
}

function getCellFromTarget(target: EventTarget | null, row: HTMLTableRowElement) {
  if (!(target instanceof HTMLElement)) return row.cells[0] ?? null
  const cell = target.closest('td') as HTMLTableCellElement | null
  if (cell && cell.parentElement === row) return cell
  return row.cells[0] ?? null
}

function clampCellIndex(row: HTMLTableRowElement, index: number) {
  if (row.cells.length === 0) return -1
  return Math.min(Math.max(index, 0), row.cells.length - 1)
}

export function TableFocusController() {
  const focusedRowRef = useRef<HTMLTableRowElement | null>(null)
  const focusedCellRef = useRef<HTMLTableCellElement | null>(null)
  const focusedCellIndexRef = useRef(0)

  useEffect(() => {
    const clearFocus = () => {
      const currentRow = focusedRowRef.current
      const currentCell = focusedCellRef.current

      currentCell?.classList.remove(FOCUSED_CELL_CLASS)
      currentRow?.classList.remove(FOCUSED_ROW_CLASS)
      currentRow?.removeAttribute('aria-selected')
      currentRow?.removeAttribute('tabindex')

      focusedRowRef.current = null
      focusedCellRef.current = null
    }

    const setFocusedRow = (row: HTMLTableRowElement, cell: HTMLTableCellElement | null, shouldMoveDomFocus = false) => {
      const nextCell = cell ?? row.cells[0] ?? null
      if (!nextCell) return

      if (focusedRowRef.current !== row) {
        clearFocus()
        focusedRowRef.current = row
        row.classList.add(FOCUSED_ROW_CLASS)
        row.setAttribute('aria-selected', 'true')
        row.tabIndex = -1
      }

      focusedCellRef.current?.classList.remove(FOCUSED_CELL_CLASS)
      focusedCellRef.current = nextCell
      focusedCellIndexRef.current = nextCell.cellIndex
      nextCell.classList.add(FOCUSED_CELL_CLASS)

      if (shouldMoveDomFocus) {
        row.focus({ preventScroll: true })
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      const row = getFocusableRow(event.target)
      if (!row) return
      const cell = getCellFromTarget(event.target, row)
      setFocusedRow(row, cell, !isInteractiveElement(event.target))
    }

    const handleFocusIn = (event: FocusEvent) => {
      const row = getFocusableRow(event.target)
      if (!row) return
      const cell = event.target === row && focusedRowRef.current === row
        ? focusedCellRef.current
        : getCellFromTarget(event.target, row)
      setFocusedRow(row, cell)
    }

    const moveFocus = (direction: 'previous' | 'next' | 'first' | 'last') => {
      const currentRow = focusedRowRef.current
      const tbody = currentRow?.parentElement as HTMLTableSectionElement | null
      if (!currentRow || !tbody) return

      const rows = getVisibleRows(tbody)
      if (rows.length === 0) return

      const currentIndex = rows.indexOf(currentRow)
      const fallbackIndex = currentIndex >= 0 ? currentIndex : 0
      const nextIndex = direction === 'first'
        ? 0
        : direction === 'last'
          ? rows.length - 1
          : direction === 'previous'
            ? Math.max(fallbackIndex - 1, 0)
            : Math.min(fallbackIndex + 1, rows.length - 1)

      const nextRow = rows[nextIndex]
      if (!nextRow) return

      const cellIndex = clampCellIndex(nextRow, focusedCellIndexRef.current)
      const nextCell = cellIndex >= 0 ? nextRow.cells[cellIndex] : null
      setFocusedRow(nextRow, nextCell, true)
      nextRow.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (!getFocusableRow(event.target)) return
      if (!focusedRowRef.current?.isConnected) return

      if (event.key === 'Escape') {
        clearFocus()
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        moveFocus('previous')
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        moveFocus('next')
        return
      }

      if (event.key === 'Home') {
        event.preventDefault()
        moveFocus('first')
        return
      }

      if (event.key === 'End') {
        event.preventDefault()
        moveFocus('last')
        return
      }

      if (event.key === ' ' && document.activeElement === focusedRowRef.current) {
        const checkbox = focusedRowRef.current.querySelector('input[type="checkbox"]:not(:disabled)') as HTMLInputElement | null
        if (checkbox) {
          event.preventDefault()
          checkbox.click()
        }
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('focusin', handleFocusIn, true)
    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('focusin', handleFocusIn, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      clearFocus()
    }
  }, [])

  return null
}
