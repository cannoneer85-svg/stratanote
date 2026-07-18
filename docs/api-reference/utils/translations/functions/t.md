[**API Reference**](/api-reference/index) / [**translations**](/api-reference/utils/translations/index)

***

> **t**(`key`, `lang`, `replacements?`): `string`

Defined in: [utils/translations.ts:799](https://github.com/cannoneer85-svg/stratanote/blob/master/_app/client/src/utils/translations.ts#L799)

Translates a given localization key into the target language interface text,
supporting string interpolation placeholders (e.g. `{name}`).

## Parameters

### key

`string`

The unique dictionary translation key (e.g. `"app_title"` or `"sidebar_confirm_delete_note"`).

### lang

[`Lang`](/api-reference/utils/translations/type-aliases/Lang)

The target language code (`"en"` or `"ru"`).

### replacements?

`Record`\<`string`, `string` \| `number`\>

Optional object containing key-value replacements to interpolate placeholders inside the string.

## Returns

`string`

The localized and interpolated string, or the raw key if not found.

## Example

```typescript
t("sidebar_confirm_delete_note", "en", { name: "Todo.md" });
// Returns: 'Are you sure you want to delete note "Todo.md"?'
```
