[**API Reference**](/api-reference/index) / [**components/ChangeOwnerModal**](/api-reference/components/ChangeOwnerModal/index)

***

> `const` **ChangeOwnerModal**: `React.FC`\<[`ChangeOwnerModalProps`](/api-reference/components/ChangeOwnerModal/interfaces/ChangeOwnerModalProps)\>

Defined in: components/ChangeOwnerModal.tsx:63

ChangeOwnerModal component rendering the dialog for transferring note or folder ownership.

## Param

**props**

Component properties [ChangeOwnerModalProps](/api-reference/components/ChangeOwnerModal/interfaces/ChangeOwnerModalProps)

## Returns

React modal component or null if not open

## Example

```tsx
<ChangeOwnerModal
  isOpen={isModalOpen}
  onClose={() => setModalOpen(false)}
  relativePath="Project/Note.md"
  title="Note.md"
  currentOwner="Внешняя система"
  isDirectory={false}
  lang="ru"
  token={authToken}
  onOwnerChanged={(path, newOwner) => console.log('Updated', path, newOwner)}
/>
```
