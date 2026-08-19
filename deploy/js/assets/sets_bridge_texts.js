// Textos de la tira "los tienes a medias" de la pestaña Set (ui_sets_bridge.js).
//
// Fuera del componente para poder comprobar en un test que cada clave existe en los dos idiomas:
// contando `clave:` dentro del .js el número salía 2 y el test pasaba aunque el texto estuviera
// vacío (misma razón que assets/farm_routes_texts.js y assets/orders_texts.js).

export const BRIDGE_TEXTS = {
    es: {
        title: "Los tienes a medias",
        oneLeft: "te falta 1",
        someLeft: "te faltan {n} de {total}",
        chipTitle: "Buscar {set}",
        // El contador va en el título: sin él, ver seis chips no distingue "tengo seis a medias"
        // de "tengo veintitrés y me enseñas seis".
        count: "{n}",
        sortNear: "Lo que menos te queda",
        sortGain: "Lo que más paga",
        sortLabel: "Ordenar la tira",
        filterPlaceholder: "Filtrar…",
        filterLabel: "Filtrar la tira por nombre de set",
        maxMissingLabel: "Máx. piezas restantes",
        // Filtra por la era de las reliquias que sueltan lo que te falta: es la pregunta
        // "tengo Lith de sobra, ¿qué cierro con ellas?".
        eraLabel: "Era de la reliquia",
        anyEra: "Cualquier era",
        anyMissing: "Cualquiera",
        // Con filtros puestos el contador dice "12 de 155": sin el total no se sabe si tienes
        // doce a medias o si el filtro te está escondiendo el resto.
        countFiltered: "{n} de {total}",
        emptyFiltered: "Ningún set a medias coincide.",
        showAll: "Ver los {n}",
        showLess: "Ver menos",
        gainTag: "+{n}",
        gainTitle: "Platino que ganas al cerrarlo: lo que vale el set entero menos lo que ya podrías vender pieza a pieza.",
    },
    en: {
        title: "You have these half-finished",
        oneLeft: "1 part left",
        someLeft: "{n} of {total} left",
        chipTitle: "Search {set}",
        count: "{n}",
        sortNear: "Fewest parts left",
        sortGain: "Pays the most",
        sortLabel: "Sort the strip",
        filterPlaceholder: "Filter\u2026",
        filterLabel: "Filter the strip by set name",
        maxMissingLabel: "Max parts left",
        eraLabel: "Relic era",
        anyEra: "Any era",
        anyMissing: "Any",
        countFiltered: "{n} of {total}",
        emptyFiltered: "No half-finished set matches.",
        showAll: "Show all {n}",
        showLess: "Show fewer",
        gainTag: "+{n}",
        gainTitle: "Platinum you gain by finishing it: what the full set is worth minus what you could already sell part by part.",
    },
};
