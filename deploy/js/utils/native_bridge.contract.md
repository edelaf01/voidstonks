# Contrato del puente nativo (`globalThis.__vsNative`)

Este documento define qué debe inyectar el contenedor de escritorio (Tauri o Electron)
para que la app funcione empaquetada. **La app web no necesita nada de esto**: si
`__vsNative` no existe, todo va por el worker como hoy.

El objetivo de empaquetar es que **las credenciales del usuario nunca pasen por el
worker**. En escritorio, el login habla directo con warframe.market —igual que un script
de Python: sin CORS, sin `HttpOnly`, sin intermediario—, y así la responsabilidad de la
contraseña deja de ser del dueño del worker.

## Forma

El contenedor debe exponer, antes de que cargue la app:

```js
globalThis.__vsNative = {
  version: "1",
  async call(type, { params, method, headers, body }) { /* … */ }
};
```

`call()` debe devolver un objeto **con forma de `Response`** —`{ status, ok, json(), text() }`—
para que [`apiCall()`](platform.js) no tenga que distinguir el camino web del nativo.

## Rutas que el puente DEBE implementar

Solo las de credenciales. El resto (`prices_batch`, `fissures`, `wfm_items`…) las sigue
sirviendo el worker incluso en escritorio: son datos compartidos y cacheados, no tiene
sentido pedirlos uno a uno desde cada instalación.

| `type` | Qué hace el nativo | Endpoint WFM |
| --- | --- | --- |
| `wfm_login` | POST directo con `{email, password}` en claro. Lee el JWT de `Set-Cookie`. **Nunca sale del proceso nativo.** | `POST /v1/auth/signin` |
| `wfm_logout` | Invalida el JWT | `POST /v2/auth/signout` |
| `wfm_my_orders` | Lee las órdenes con el JWT | `GET /v2/orders/my` |
| `wfm_order_create` | Publica una orden | `POST /v2/order` |
| `wfm_order_edit` | Edita/cierra/borra | `PATCH·POST·DELETE /v2/order/{id}` |

Cabeceras hacia WFM: `Authorization: JWT` en el signin; en el resto, el JWT como
`Authorization: Bearer <token>` **y** `Cookie: JWT=<token>` (WFM valida por cookie; enviar
ambos cubre cualquiera de los dos). User-Agent descriptivo obligatorio:
`VoidStonks/<versión> (+https://voidstonks.com)`.

## Dónde vive el JWT en escritorio

En el proceso nativo, no en el WebView. El WebView pide "haz login" y "dame mis órdenes";
el token no baja al JavaScript salvo lo imprescindible. Así un XSS en la web empaquetada
no puede robar la sesión.

## Lo que el puente NO debe hacer

- No tocar `prices_batch` ni las rutas públicas: van al worker.
- No guardar la contraseña. Se usa una vez para el signin y se descarta, igual que en la
  versión web.

## Estado

El contenedor todavía no existe: esto es la especificación para construirlo. La capa
[`platform.js`](platform.js) ya está lista para usarlo en cuanto aparezca —`isDesktop()`
lo detecta por la presencia de `__vsNative`— sin que la web se entere de nada.
