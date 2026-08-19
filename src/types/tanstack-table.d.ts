import '@tanstack/react-table'

// TanStack Table's ColumnMeta is an empty interface by design, extended via module
// augmentation per their own docs. `className` is the one custom column-meta property this
// app's admin tables use, for header/cell-level styling hooks.
declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    className?: string
  }
}
