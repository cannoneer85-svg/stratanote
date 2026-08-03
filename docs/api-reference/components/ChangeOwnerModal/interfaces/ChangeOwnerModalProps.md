[**API Reference**](/api-reference/index) / [**components/ChangeOwnerModal**](/api-reference/components/ChangeOwnerModal/index)

***

Defined in: components/ChangeOwnerModal.tsx:21

Props for [ChangeOwnerModal](/api-reference/components/ChangeOwnerModal/variables/ChangeOwnerModal) component.

## Properties

### currentOwner

> **currentOwner**: `string`

Defined in: components/ChangeOwnerModal.tsx:31

Current owner username of item

***

### isDirectory

> **isDirectory**: `boolean`

Defined in: components/ChangeOwnerModal.tsx:33

Whether target item is a directory

***

### isOpen

> **isOpen**: `boolean`

Defined in: components/ChangeOwnerModal.tsx:23

Controls modal visibility

***

### lang

> **lang**: [`Lang`](/api-reference/utils/translations/type-aliases/Lang)

Defined in: components/ChangeOwnerModal.tsx:35

Interface language

***

### onClose

> **onClose**: () => `void`

Defined in: components/ChangeOwnerModal.tsx:25

Callback triggered when modal is requested to close

#### Returns

`void`

***

### onOwnerChanged

> **onOwnerChanged**: (`relativePath`, `newOwner`, `recursive`) => `void`

Defined in: components/ChangeOwnerModal.tsx:39

Callback executed when owner is successfully updated

#### Parameters

##### relativePath

`string`

##### newOwner

`string`

##### recursive

`boolean`

#### Returns

`void`

***

### relativePath

> **relativePath**: `string`

Defined in: components/ChangeOwnerModal.tsx:27

Relative path of target note or directory

***

### title

> **title**: `string`

Defined in: components/ChangeOwnerModal.tsx:29

Title or display name of target item

***

### token

> **token**: `string`

Defined in: components/ChangeOwnerModal.tsx:37

Authentication JWT token
