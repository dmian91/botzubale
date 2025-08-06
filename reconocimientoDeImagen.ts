import { createWorker } from "tesseract.js";
import { Page } from "@browserbasehq/stagehand";
import chalk from "chalk";
import boxen from "boxen";

/**
 * Identifica la imagen de un ticket entre varias rutas de archivos, corrige su orientación y extrae
 * un código de domicilio que coincide con un patrón específico.
 * 
 * @param listaRutasImagenes Una lista de rutas a los archivos de imagen.
 * @returns Un objeto con el resultado de la extracción o un error.
 */
export async function encontrarYExtraerInfoTicket(listaRutasImagenes: string[]): Promise<any> {
    if (!listaRutasImagenes || listaRutasImagenes.length === 0) {
        return { error: "La lista de imágenes está vacía." };
    }

    let mejorCandidato: string | null = null;
    let maxLongitudTexto = -1;
    const worker = await createWorker('spa');

    // --- PASO 1: IDENTIFICAR EL TICKET POR DENSIDAD DE TEXTO ---
    console.log("Identificando el ticket con más texto...");
    for (const rutaImg of listaRutasImagenes) {
        try {
            const { data: { text } } = await worker.recognize(rutaImg);
            if (text.length > maxLongitudTexto) {
                maxLongitudTexto = text.length;
                mejorCandidato = rutaImg;
            }
        } catch (error) {
            console.warn(`Advertencia: Se ignoró el archivo ${rutaImg} (podría no ser una imagen o estar dañado).`);
            continue;
        }
    }

    if (!mejorCandidato) {
        await worker.terminate();
        return { error: "No se pudo identificar un ticket válido entre las imágenes proporcionadas." };
    }

    console.log(`Ticket identificado: ${mejorCandidato}`);

    // --- PASO 2 Y 3: CORREGIR Y EXTRAER DEL MEJOR CANDIDATO ---
    try {
        console.log("Extrayendo texto del ticket identificado...");
        const { data: { text: textoFinal } } = await worker.recognize(mejorCandidato);
        
        const patronDomicilio = /Domicilio:\s*(JMB-[^\s]+)/;
        const coincidencia = patronDomicilio.exec(textoFinal);
        
        if (coincidencia && coincidencia[1]) {
            const codigoDomicilio = coincidencia[1];
            await worker.terminate();
            return {
                ticket_identificado: mejorCandidato,
                domicilio: codigoDomicilio
            };
        } else {
            await worker.terminate();
            return {
                error: "Se identificó un ticket, pero no se encontró el domicilio 'JMB-'.",
                ticket_identificado: mejorCandidato
            };
        }
            
    } catch (e) {
        await worker.terminate();
        const errorMessage = e instanceof Error ? e.message : String(e);
        return { error: `Ocurrió un error al procesar el ticket seleccionado: ${errorMessage}` };
    }
}

/**
 * Analiza la página actual para encontrar el ticket entre las evidencias
 * y extraer el código de domicilio, con mensajes detallados en cada paso.
 * @param page - El objeto Page de Playwright/Stagehand.
 * @returns Un objeto con el resultado o un error.
 */
export async function analizarTareaActual(page: Page): Promise<{ error: boolean; mensaje: string; domicilio?: string }> {
    console.log(boxen("Iniciando análisis de evidencias en pantalla...", { padding: 1, borderColor: 'cyan' }));

    // --- PASO 1: LOCALIZAR EL CONTENEDOR DE IMÁGENES ---
    const selectorContenedorXPath = '//*[@id="root"]/div/div[2]/div/div/div[3]/div[1]/div[2]/div';
    console.log(`1. Buscando contenedor de imágenes con XPath: ${selectorContenedorXPath}`);
    const contenedorImagenes = page.locator(selectorContenedorXPath);
    
    try {
        await contenedorImagenes.waitFor({ state: 'visible', timeout: 10000 });
        console.log(chalk.green("✔ Contenedor principal encontrado."));
    } catch (e) {
        console.error(chalk.red("❌ Error: No se encontró el contenedor de imágenes usando el XPath proporcionado."));
        throw new Error("No se encontró el contenedor de imágenes.");
    }

    // --- PASO 2: LOCALIZAR LAS IMÁGENES DENTRO DEL CONTENEDOR ---
    console.log("\n2. Buscando todas las imágenes de evidencia (thumbnails)...");
    const elementosEvidencia = await contenedorImagenes.locator("img.thumb").all();
    if (elementosEvidencia.length === 0) {
        return { error: true, mensaje: "Contenedor encontrado, pero no había imágenes de evidencia." };
    }
    console.log(chalk.green(`✔ Se encontraron ${elementosEvidencia.length} evidencias para analizar.`));

    // --- PASO 3: CLASIFICAR IMÁGENES PARA ENCONTRAR EL TICKET ---
    console.log(chalk.cyan("\n3. Iniciando clasificación para encontrar el ticket (la imagen con más texto)..."));
    let mejorCandidatoElemento = null;
    let maxLongitudTexto = -1;
    const worker = await createWorker('spa');

    for (const [index, elemento] of elementosEvidencia.entries()) {
        console.log(chalk.yellow(`\n--- Analizando Evidencia #${index + 1} ---`));
        try {
            console.log("  3.1. Tomando captura de pantalla del elemento...");
            const screenshotBuffer = await elemento.screenshot();
            
            console.log("  3.2. Enviando imagen a Tesseract OCR para análisis de densidad...");
            const { data: { text } } = await worker.recognize(screenshotBuffer);
            console.log(`  3.3. Análisis OCR completado. Texto reconocido: ${chalk.bold(text.length)} caracteres.`);

            if (text.length > maxLongitudTexto) {
                console.log(chalk.magenta(`  ✨ ¡Nuevo candidato a ticket encontrado! (anterior max: ${maxLongitudTexto})`));
                maxLongitudTexto = text.length;
                mejorCandidatoElemento = elemento;
            }
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.log(chalk.red(`  ❌ Error al procesar esta evidencia: ${errorMessage}`));
            continue;
        }
    }

    if (!mejorCandidatoElemento) {
        await worker.terminate();
        return { error: true, mensaje: "No se pudo identificar un ticket válido entre las evidencias." };
    }

    console.log(chalk.green("\n✔ Clasificación completada. El ticket con más texto fue identificado."));

    // --- PASO 4: EXTRACCIÓN FINAL DEL TICKET IDENTIFICADO ---
    console.log(chalk.cyan("\n4. Iniciando extracción final de datos del ticket..."));
    try {
        console.log("  4.1. Tomando captura de pantalla final del ticket...");
        const screenshotFinal = await mejorCandidatoElemento.screenshot();

        console.log("  4.2. Realizando OCR de alta calidad en la imagen final...");
        const { data: { text: textoFinal } } = await worker.recognize(screenshotFinal);
        console.log(chalk.green("  ✔ OCR final completado."));

        console.log("  4.3. Buscando el patrón 'Domicilio: JMB-...' con Expresión Regular...");
        const patronDomicilio = /Domicilio:\s*(JMB-[^\s]+)/;
        const coincidencia = textoFinal.match(patronDomicilio);

        if (coincidencia && coincidencia[1]) {
            console.log(chalk.green("  ✔ ¡Patrón de domicilio encontrado!"));
            await worker.terminate();
            return {
                error: false,
                mensaje: "Extracción exitosa.",
                domicilio: coincidencia[1]
            };
        } else {
            console.log(chalk.red("  ❌ Patrón de domicilio no encontrado en el texto del ticket."));
            await worker.terminate();
            return { error: true, mensaje: "Ticket identificado, pero no se encontró el domicilio con formato JMB-." };
        }
    } catch (e) {
        await worker.terminate();
        const errorMessage = e instanceof Error ? e.message : String(e);
        return { error: true, mensaje: `Error en la extracción final: ${errorMessage}` };
    }
}