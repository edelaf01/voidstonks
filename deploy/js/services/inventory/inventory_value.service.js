import { state } from "../../state.js";
import { getRequiredCount } from "../../utils/ui_utils.js";

/**
 * Cuánto vale un grupo del inventario Prime.
 *
 * El valor de N piezas sueltas no es la suma de sus precios: en cuanto hay piezas para armar
 * un set, ese set vale su precio de "... Set" —normalmente más que las piezas por separado—
 * y solo lo que sobra se cuenta suelto. Sin eso, un inventario completo se infravalora.
 *
 * Se cae a la suma simple cuando no se sabe qué piezas lleva el set o cuando su precio aún
 * no ha llegado: mejor un total conservador que uno inventado.
 */

export function calculateGroupSubtotal(setName, groupData) {
  if (setName === "Otros") {
    return sumIndividualParts(groupData.parts);
  }

  let allPossibleParts = [];
  if (state.setsDatabase?.[setName]) {
    allPossibleParts = state.setsDatabase[setName];
  } else {
    allPossibleParts = Object.keys(state.itemsDatabase).filter(
      (name) =>
        (name === setName || name.startsWith(setName + " ")) &&
        !name.endsWith(" Set"),
    );
  }

  if (allPossibleParts.length === 0) {
    return sumIndividualParts(groupData.parts);
  }

  const numSets = calculatePossibleSets(setName, groupData, allPossibleParts);

  if (numSets > 0 && groupData.setPriceLoaded) {
    return calculateSetPlusLeftovers(setName, groupData, numSets);
  }

  return sumIndividualParts(groupData.parts);
}

export function sumIndividualParts(parts) {
  let subtotal = 0;
  for (const p in parts) {
    const qty = parts[p].qty || 0;
    const price = parts[p].price || 0;
    subtotal += qty * price;
  }
  return subtotal;
}

export function calculatePossibleSets(setName, groupData, allPossibleParts) {
  let numSets = 999;

  allPossibleParts.forEach((p) => {
    const hasQty = groupData.parts[p]?.qty || 0;
    const required = getRequiredCount(setName, p) || 1;
    const possibleSets = Math.floor(hasQty / required);

    if (possibleSets < numSets) {
      numSets = possibleSets;
    }
  });

  return numSets === 999 ? 0 : numSets;
}

export function calculateSetPlusLeftovers(setName, groupData, numSets) {
  let subtotal = numSets * (groupData.setPrice || 0);

  for (const partName in groupData.parts) {
    const required = getRequiredCount(setName, partName) || 1;
    const remaining = (groupData.parts[partName].qty || 0) - numSets * required;

    if (remaining > 0) {
      subtotal += remaining * (groupData.parts[partName].price || 0);
    }
  }

  return subtotal;
}
