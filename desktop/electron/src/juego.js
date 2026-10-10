import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const CLASE_WARFRAME = "steam_app_230410";
const TITULO_WARFRAME = "Warframe";

let nativo = null;

function cargaWindows() {
  const koffi = require("koffi");
  const user32 = koffi.load("user32.dll");
  koffi.struct("RECT", { left: "long", top: "long", right: "long", bottom: "long" });
  koffi.struct("POINT", { x: "long", y: "long" });
  const f = {
    FindWindowW: user32.func("void *__stdcall FindWindowW(const char16_t *cls, const char16_t *name)"),
    IsWindowVisible: user32.func("bool __stdcall IsWindowVisible(void *hwnd)"),
    IsIconic: user32.func("bool __stdcall IsIconic(void *hwnd)"),
    GetClientRect: user32.func("bool __stdcall GetClientRect(void *hwnd, _Out_ RECT *r)"),
    ClientToScreen: user32.func("bool __stdcall ClientToScreen(void *hwnd, _Inout_ POINT *p)"),
  };
  return {
    ventanaDelJuego() {
      const hwnd = f.FindWindowW(null, TITULO_WARFRAME);
      if (!hwnd || !f.IsWindowVisible(hwnd) || f.IsIconic(hwnd)) return null;
      const r = {};
      const p = { x: 0, y: 0 };
      if (!f.GetClientRect(hwnd, r) || !f.ClientToScreen(hwnd, p)) return null;
      const width = r.right - r.left, height = r.bottom - r.top;
      return width > 0 && height > 0 ? { x: p.x, y: p.y, width, height } : null;
    },
    estadoDelJuego() {
      const hwnd = f.FindWindowW(null, TITULO_WARFRAME);
      if (!hwnd) return null;
      return f.IsWindowVisible(hwnd) && !f.IsIconic(hwnd) ? "visible" : "oculto";
    },
    sinGestor() {},
    zonasDeEntrada() {},
  };
}

const ventanaDeAsa = (asa) => (asa.length >= 8 ? Number(asa.readBigUInt64LE(0)) : asa.readUInt32LE(0));

function cargaX11() {
  const koffi = require("koffi");
  const x = koffi.load("libX11.so.6");
  const xext = koffi.load("libXext.so.6");
  koffi.opaque("Display");
  const XErrorHandler = koffi.proto("int XErrorHandler(Display *dpy, void *ev)");
  koffi.struct("XClassHint", { res_name: "void *", res_class: "void *" });
  koffi.struct("XWindowAttributes", {
    x: "int", y: "int", width: "int", height: "int", border_width: "int", depth: "int",
    visual: "void *", root: "unsigned long", class: "int", bit_gravity: "int", win_gravity: "int",
    backing_store: "int", backing_planes: "unsigned long", backing_pixel: "unsigned long", save_under: "int",
    colormap: "unsigned long", map_installed: "int", map_state: "int", all_event_masks: "long",
    your_event_mask: "long", do_not_propagate_mask: "long", override_redirect: "int", screen: "void *",
  });
  koffi.struct("XSetWindowAttributes", {
    background_pixmap: "unsigned long", background_pixel: "unsigned long", border_pixmap: "unsigned long",
    border_pixel: "unsigned long", bit_gravity: "int", win_gravity: "int", backing_store: "int",
    backing_planes: "unsigned long", backing_pixel: "unsigned long", save_under: "int", event_mask: "long",
    do_not_propagate_mask: "long", override_redirect: "int", colormap: "unsigned long", cursor: "unsigned long",
  });
  const f = {
    XOpenDisplay: x.func("Display *XOpenDisplay(const char *name)"),
    XDefaultRootWindow: x.func("unsigned long XDefaultRootWindow(Display *dpy)"),
    XQueryTree: x.func("int XQueryTree(Display *dpy, unsigned long w, _Out_ unsigned long *root, _Out_ unsigned long *parent, _Out_ void **children, _Out_ unsigned int *n)"),
    XGetClassHint: x.func("int XGetClassHint(Display *dpy, unsigned long w, _Out_ XClassHint *hint)"),
    XFetchName: x.func("int XFetchName(Display *dpy, unsigned long w, _Out_ void **name)"),
    XGetWindowAttributes: x.func("int XGetWindowAttributes(Display *dpy, unsigned long w, _Out_ XWindowAttributes *attrs)"),
    XTranslateCoordinates: x.func("int XTranslateCoordinates(Display *dpy, unsigned long src, unsigned long dst, int sx, int sy, _Out_ int *dx, _Out_ int *dy, _Out_ unsigned long *child)"),
    XChangeWindowAttributes: x.func("int XChangeWindowAttributes(Display *dpy, unsigned long w, unsigned long mask, XSetWindowAttributes *attrs)"),
    XSetErrorHandler: x.func("void *XSetErrorHandler(void *handler)"),
    XSync: x.func("int XSync(Display *dpy, int discard)"),
    XFree: x.func("int XFree(void *p)"),
    XShapeCombineRectangles: xext.func("void XShapeCombineRectangles(Display *dpy, unsigned long w, int kind, int x, int y, void *rects, int n, int op, int ordering)"),
  };
  const ignora = koffi.register(() => 0, koffi.pointer(XErrorHandler));
  let dpy = null;

  const texto = (ptr) => {
    if (!ptr) return "";
    const s = koffi.decode(ptr, "char", -1);
    f.XFree(ptr);
    return s;
  };

  const conDisplay = (fn) => {
    dpy ||= f.XOpenDisplay(null);
    if (!dpy) return null;
    const previo = f.XSetErrorHandler(ignora);
    try {
      return fn(dpy);
    } finally {
      f.XSync(dpy, 0);
      f.XSetErrorHandler(previo);
    }
  };

  const esWarframe = (d, w) => {
    const hint = {};
    let clase = "";
    if (f.XGetClassHint(d, w, hint)) clase = `${texto(hint.res_name)} ${texto(hint.res_class)}`;
    if (clase.includes(CLASE_WARFRAME)) return true;
    const nombre = [null];
    return f.XFetchName(d, w, nombre) ? texto(nombre[0]) === TITULO_WARFRAME : false;
  };

  const hijosDeRaiz = (d) => {
    const r = [0], p = [0], hijos = [null], n = [0];
    if (!f.XQueryTree(d, f.XDefaultRootWindow(d), r, p, hijos, n) || !hijos[0]) return [];
    const lista = n[0] ? koffi.decode(hijos[0], "unsigned long", n[0]) : [];
    f.XFree(hijos[0]);
    return lista;
  };
  let vista = 0;

  return {
    ventanaDelJuego() {
      return conDisplay((d) => {
        const root = f.XDefaultRootWindow(d);
        for (const w of hijosDeRaiz(d)) {
          if (!esWarframe(d, w)) continue;
          const a = {};
          if (!f.XGetWindowAttributes(d, w, a) || a.map_state !== 2) continue;
          const dx = [0], dy = [0], hijo = [0];
          if (!f.XTranslateCoordinates(d, w, root, 0, 0, dx, dy, hijo)) continue;
          return { x: dx[0], y: dy[0], width: a.width, height: a.height };
        }
        return null;
      });
    },
    estadoDelJuego() {
      return conDisplay((d) => {
        const a = {};
        if (vista && esWarframe(d, vista) && f.XGetWindowAttributes(d, vista, a) && a.map_state === 2) return "visible";
        vista = 0;
        let hay = false;
        for (const w of hijosDeRaiz(d)) {
          if (!esWarframe(d, w)) continue;
          hay = true;
          const b = {};
          if (f.XGetWindowAttributes(d, w, b) && b.map_state === 2) {
            vista = w;
            return "visible";
          }
        }
        return hay ? "oculto" : null;
      });
    },
    zonasDeEntrada(asa, rects) {
      const w = ventanaDeAsa(asa);
      const buf = Buffer.alloc(Math.max(8, rects.length * 8));
      rects.forEach((r, i) => {
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, r.x)), i * 8);
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, r.y)), i * 8 + 2);
        buf.writeUInt16LE(Math.max(0, Math.min(65535, r.width)), i * 8 + 4);
        buf.writeUInt16LE(Math.max(0, Math.min(65535, r.height)), i * 8 + 6);
      });
      return conDisplay((d) => {
        const SHAPE_INPUT = 2, SHAPE_SET = 0, UNSORTED = 0;
        f.XShapeCombineRectangles(d, w, SHAPE_INPUT, 0, 0, rects.length ? buf : null, rects.length, SHAPE_SET, UNSORTED);
        return true;
      });
    },
    sinGestor(asa) {
      const w = ventanaDeAsa(asa);
      return conDisplay((d) => {
        const CW_OVERRIDE_REDIRECT = 1 << 9;
        f.XChangeWindowAttributes(d, w, CW_OVERRIDE_REDIRECT, { override_redirect: 1 });
        return true;
      });
    },
  };
}

function carga() {
  if (nativo) return nativo;
  try {
    nativo = process.platform === "win32" ? cargaWindows() : cargaX11();
  } catch (e) {
    console.error("[juego] sin acceso nativo a las ventanas:", e);
    nativo = { ventanaDelJuego: () => null, estadoDelJuego: () => null, sinGestor: () => false, zonasDeEntrada: () => false };
  }
  return nativo;
}

export function puedePintar() {
  return process.platform === "win32" || (process.platform === "linux" && !!process.env.DISPLAY);
}

export function ventanaDelJuego() {
  try {
    return carga().ventanaDelJuego();
  } catch (e) {
    console.error("[juego] no se pudo buscar la ventana de Warframe:", e);
    return null;
  }
}

let falloEstado = false;

export function estadoDelJuego() {
  try {
    return carga().estadoDelJuego();
  } catch (e) {
    if (!falloEstado) console.error("[juego] no se pudo mirar si Warframe está a la vista:", e);
    falloEstado = true;
    return null;
  }
}

export function zonasDeEntrada(asa, rects) {
  try {
    return carga().zonasDeEntrada(asa, rects);
  } catch (e) {
    console.error("[juego] no se pudo poner la zona clicable del overlay:", e);
    return false;
  }
}

export function sinGestor(asa) {
  try {
    return carga().sinGestor(asa);
  } catch (e) {
    console.error("[juego] no se pudo sacar el overlay del gestor de ventanas:", e);
    return false;
  }
}
