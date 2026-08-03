[**API Reference**](/api-reference/index) / [**utils/theme**](/api-reference/utils/theme/index)

***

> **getActiveTheme**(`username?`): [`ThemeId`](/api-reference/utils/theme/type-aliases/ThemeId)

Defined in: [utils/theme.ts:92](https://github.com/cannoneer85-svg/stratanote/blob/master/_app/client/src/utils/theme.ts#L92)

Gets the current active theme identifier for the given user from localStorage.
Falls back to `dark-purple` if nothing is saved or the value is invalid.

## Parameters

### username?

`string`

Optional username. If omitted uses the module-level active user.

## Returns

[`ThemeId`](/api-reference/utils/theme/type-aliases/ThemeId)

The resolved ThemeId.
