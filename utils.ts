import { ObserveResult, Page } from "@browserbasehq/stagehand";
import boxen from "boxen";
import chalk from "chalk";
import fs from "fs/promises";
import { z } from "zod";
import { createWorker } from "tesseract.js";

export function announce(message: string, title?: string) {
  console.log(
    boxen(message, {
      padding: 1,
      margin: 3,
      title: title || "Stagehand",
    }),
  );
}

/**
 * Obtiene una variable de entorno y arroja un error si no se encuentra
 * @param name - El nombre de la variable de entorno
 * @returns El valor de la variable de entorno
 */
export function getEnvVar(name: string, required = true): string | undefined {
  const value = process.env[name];
  if (!value && required) {
    throw new Error(`${name} no se encontró en las variables de entorno`);
  }
  return value;
}

/**
 * Valida un esquema Zod contra algunos datos
 * @param schema - El esquema Zod para validar
 * @param data - Los datos a validar
 * @returns Si los datos son válidos contra el esquema
 */
export function validateZodSchema(schema: z.ZodTypeAny, data: unknown) {
  try {
    schema.parse(data);
    return true;
  } catch {
    return false;
  }
}

export async function drawObserveOverlay(page: Page, results: ObserveResult[]) {
  // Convierte un solo xpath a un array para un manejo consistente
  const xpathList = results.map((result) => result.selector);

  // Filtra los xpaths vacíos
  const validXpaths = xpathList.filter((xpath) => xpath !== "xpath=");

  await page.evaluate((selectors) => {
    selectors.forEach((selector) => {
      let element;
      if (selector.startsWith("xpath=")) {
        const xpath = selector.substring(6);
        element = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        ).singleNodeValue;
      } else {
        element = document.querySelector(selector);
      }

      if (element instanceof HTMLElement) {
        const overlay = document.createElement("div");
        overlay.setAttribute("stagehandObserve", "true");
        const rect = element.getBoundingClientRect();
        overlay.style.position = "absolute";
        overlay.style.left = rect.left + "px";
        overlay.style.top = rect.top + "px";
        overlay.style.width = rect.width + "px";
        overlay.style.height = rect.height + "px";
        overlay.style.backgroundColor = "rgba(255, 255, 0, 0.3)";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "10000";
        document.body.appendChild(overlay);
      }
    });
  }, validXpaths);
}

export async function clearOverlays(page: Page) {
  // elimina los atributos stagehandObserve existentes
  await page.evaluate(() => {
    const elements = document.querySelectorAll('[stagehandObserve="true"]');
    elements.forEach((el) => {
      const parent = el.parentNode;
      while (el.firstChild) {
        parent?.insertBefore(el.firstChild, el);
      }
      parent?.removeChild(el);
    });
  });
}

export async function simpleCache(
  instruction: string,
  actionToCache: ObserveResult,
) {
  // Guarda la acción en cache.json
  try {
    // Lee la caché existente si existe
    let cache: Record<string, ObserveResult> = {};
    try {
      const existingCache = await fs.readFile("cache.json", "utf-8");
      cache = JSON.parse(existingCache);
    } catch (error) {
      // El archivo aún no existe, usa una caché vacía
    }

    // Agrega una nueva acción a la caché
    cache[instruction] = actionToCache;

    // Escribe la caché actualizada en el archivo
    await fs.writeFile("cache.json", JSON.stringify(cache, null, 2));
  } catch (error) {
    console.error(chalk.red("Error al guardar en la caché:"), error);
  }
}

export async function readCache(
  instruction: string,
): Promise<ObserveResult | null> {
  try {
    const existingCache = await fs.readFile("cache.json", "utf-8");
    const cache: Record<string, ObserveResult> = JSON.parse(existingCache);
    return cache[instruction] || null;
  } catch (error) {
    return null;
  }
}

/**
 * Esta función se utiliza para actuar con una acción almacenable en caché.
 * Primero intentará obtener la acción de la caché.
 * Si no está en la caché, observará la página y almacenará en caché el resultado.
 * Luego ejecutará la acción.
 * @param instruction - La instrucción con la que actuar.
 */
export async function actWithCache(
  page: Page,
  instruction: string,
): Promise<void> {
  // Intenta obtener la acción de la caché primero
  const cachedAction = await readCache(instruction);
  if (cachedAction) {
    console.log(chalk.blue("Usando acción de caché para:"), instruction);
    await page.act(cachedAction);
    return;
  }

  // Si no está en la caché, observa la página y almacena en caché el resultado
  const results = await page.observe(instruction);
  console.log(chalk.blue("Resultados obtenidos:"), results);

  // Almacena en caché la acción de playwright
  const actionToCache = results[0];
  console.log(chalk.blue("Tomando acción almacenable en caché:"), actionToCache);
  await simpleCache(instruction, actionToCache);
  // OPCIONAL: Dibuja una superposición sobre los xpaths relevantes
  await drawObserveOverlay(page, results);
  await page.waitForTimeout(1000); // Puede eliminar esta línea, es solo una pausa para ver la superposición
  await clearOverlays(page);

  // Ejecuta la acción
  await page.act(actionToCache);
}

export async function login(page: Page, username: string, password: string) {
    console.log("Haciendo clic en el campo de usuario...");
    await page.click('input[id="username"]');
    console.log("Ingresando usuario...");
    await page.fill('input[id="username"]', username);
    console.log("Haciendo clic en el campo de contraseña...");
    await page.click('input[id="password"]');
    console.log("Ingresando contraseña...");
    await page.fill('input[id="password"]', password);
    console.log("Presionando Enter...");
    await page.press('input[id="password"]', 'Enter');

    try {
        await page.waitForNavigation({ waitUntil: 'networkidle' });
        console.log("Inicio de sesión exitoso.");
    } catch (error) {
        console.error("Error al iniciar sesión:", error);
    }
}

export async function filtrarPorCliente(page: Page, cliente: string) {
    console.log(`Filtrando por cliente: ${cliente}...`);
    try {
        await page.click('input[id="brand"]');
        await page.fill('input[id="brand"]', cliente);
        await page.press('input[id="brand"]', 'Enter');
        console.log("Filtro aplicado exitosamente.");
    } catch (error) {
        console.error("Error al aplicar el filtro:", error);
    }
}

/**
 * Espera a que aparezca una tarea, extrae su ID y hace clic para abrirla.
 * Si no aparece ninguna tarea en el tiempo especificado, recarga la página.
 * @param page - El objeto Page de Playwright.
 * @returns El ID de la tarea si se abrió exitosamente, o null si no.
 */
async function abrirSiguienteTarea(page: Page): Promise<string | null> {
  console.log("Buscando una nueva tarea para abrir...");
  // Localizar la primera fila que contiene un enlace de tarea
  const taskRow = page.locator('.rt-tr-group').filter({ has: page.locator('a[href^="/submission/"]') }).first();

  try {
    await taskRow.waitFor({ state: 'visible', timeout: 15000 });

    // Extraer el ID de la tarea desde la celda específica que coincide con el estilo
    const idCell = taskRow.locator('div[style*="flex: 300 0 auto;"]');
    const taskId = await idCell.textContent();

    if (!taskId) {
      console.log("No se pudo extraer el ID de la tarea. Saltando...");
      return null;
    }

    console.log(`Encontrada tarea con ID: ${taskId}. Abriendo...`);
    await taskRow.locator('a:has-text("VIEW")').click();
    return taskId.trim();

  } catch (error) {
    console.log("No se encontraron tareas. Recargando la página...");
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    return null;
  }
}

/**
 * Verifica si una tarea ya ha sido aprobada.
 * @param page - El objeto Page de Playwright.
 * @param taskId - El ID de la tarea que se está procesando.
 * @returns True si la tarea ya fue aprobada, false en caso contrario.
 */
async function verificarTareaAprobada(page: Page, taskId: string): Promise<boolean> {
  console.log(`Verificando si la tarea ${taskId} ya fue revisada...`);
  const reviewerElement = page.locator('div.col:has-text("Reviewer:")').first();
  
  await reviewerElement.waitFor({ state: 'visible', timeout: 15000 });

  const reviewerText = await reviewerElement.textContent();

  if (reviewerText && reviewerText.includes('@')) {
    const reviewer = reviewerText.replace('Reviewer:', '').trim();
    console.log(`La tarea ${taskId} ya fue revisada por: ${reviewer}.`);
    await Registrotareas(taskId, `Ya revisada por ${reviewer}`);
    return true;
  }
  return false;
}

/**
 * Maneja la lógica posterior a la aprobación de una tarea, verificando si ya fue aprobada por otro.
 * @param page - El objeto Page de Playwright.
 * @param taskId - El ID de la tarea que se está procesando.
 * @param cliente - El nombre del cliente para volver a filtrar si es necesario.
 */
async function manejarAprobacionPostClick(page: Page, taskId: string, cliente: string) {
  // Buscar el mensaje "Quest Completion Failed"
  const questFailedMessage = page.locator('text="Quest Completion Failed"'); 
  // Buscar el mensaje "aprobadas previamente" con expresión regular para el ID y el correo
  const alreadyApprovedMessage = page.locator('text=/Se encontraron 1 tareas con taskid:.*aprobadas previamente - luego el correo de la persona que la aprobo/');

  try {
    // Esperar un corto tiempo para que el mensaje de "Quest Completion Failed" aparezca
    await questFailedMessage.waitFor({ state: 'visible', timeout: 3000 }); 
    console.log(`La tarea ${taskId} ya había sido aprobada por otro usuario (Quest Completion Failed). Volviendo a la lista.`);
    await Registrotareas(taskId, "Ya aprobada por otro usuario (Quest Completion Failed)");
    await volverALaLista(page, cliente);
  } catch (error) {
    try {
      // Si no aparece el primer mensaje, intentar con el segundo
      await alreadyApprovedMessage.waitFor({ state: 'visible', timeout: 3000 });
      console.log(`La tarea ${taskId} ya había sido aprobada previamente por otro usuario. Volviendo a la lista.`);
      await Registrotareas(taskId, "Ya aprobada previamente por otro usuario");
      await volverALaLista(page, cliente);
    } catch (innerError) {
      // Si ninguno de los mensajes aparece, asumimos que la aprobación fue exitosa
      console.log(`¡Tarea ${taskId} aprobada exitosamente!`);
      await Registrotareas(taskId, "Aprobada");
    }
  }
}

/**
 * Aprueba una tarea.
 * @param page - El objeto Page de Playwright.
 * @param taskId - El ID de la tarea que se está procesando.
 * @param cliente - El nombre del cliente para volver a filtrar si es necesario.
 */
async function aprobarTarea(page: Page, taskId: string, cliente: string) {
  console.log(`Aprobando tarea ${taskId}...`);
  const approveButton = page.locator('button.btn-success:has-text("Approve (A)")');
  await approveButton.click();
  await page.waitForTimeout(2000); // Esperar 2 segundos después de aprobar
  
  await manejarAprobacionPostClick(page, taskId, cliente);
}

/**
 * Procesa la página de una tarea individual después de que ha sido abierta.
 * @param page - El objeto Page de Playwright.
 * @param taskId - El ID de la tarea que se está procesando.
 */
async function procesarPaginaDeTarea(page: Page, taskId: string, cliente: string) {
  try {
    console.log(`Procesando tarea ${taskId}...`);
    await page.waitForTimeout(2000); // Esperar 2 segundos para asegurar que el campo Reviewer esté visible
    
    const yaAprobada = await verificarTareaAprobada(page, taskId);

    if (!yaAprobada) {
      await aprobarTarea(page, taskId, cliente);
    }
  } catch (error) {
    console.error(`Error al procesar la tarea ${taskId}: No se encontró el campo 'Reviewer' a tiempo. Saltando a la siguiente.`);
    await Registrotareas(taskId, "Error - No se encontró Reviewer");
  }
}

/**
 * Vuelve a la lista de tareas y espera a que esté lista para la siguiente iteración.
 * @param page - El objeto Page de Playwright.
 * @param cliente - El nombre del cliente para volver a filtrar.
 */
async function volverALaLista(page: Page, cliente: string) {
  console.log("Volviendo a la lista de tareas...");
  await page.goto("https://zombie-app.zubale.com/submissions/new");
  await filtrarPorCliente(page, cliente);
  await page.waitForLoadState('domcontentloaded');
  try {
    await page.locator('a[href^="/submission/"]:has-text("VIEW")').first().waitFor({ state: 'visible', timeout: 10000 });
  } catch (error) {
    console.log("La lista de tareas no cargó como se esperaba, se intentará de nuevo.");
  }
}

/**
 * Navega a la página de inicio y vuelve a aplicar el filtro del cliente.
 * Se utiliza para recuperarse de errores inesperados.
 * @param page - El objeto Page de Playwright.
 * @param cliente - El nombre del cliente para volver a filtrar.
 */
async function recuperarEstado(page: Page, cliente: string) {
  console.log("Recuperando estado volviendo a la página de inicio y aplicando filtro...");
  await page.goto("https://zombie-app.zubale.com/submissions/new");
  await filtrarPorCliente(page, cliente);
  await page.waitForLoadState('domcontentloaded');
}

/**
 * Registra una acción en el archivo de log de revisiones.
 * @param taskId - El ID de la tarea.
 * @param status - El estado de la revisión (ej: "Aprobada", "Ya revisada").
 */
async function Registrotareas(taskId: string, status: string) {
  const timestamp = new Date().toLocaleString();
  const logEntry = `${timestamp} - ID: ${taskId} - Estado: ${status}\n`;

  try {
    await fs.appendFile("revisiones.log", logEntry);
  } catch (error) {
    console.error("Error al escribir en el archivo de log:", error);
  }
}

/**
 * Ciclo principal que orquesta el proceso de revisión de tareas.
 * @param page - El objeto Page de Playwright.
 * @param cliente - El nombre del cliente que se está filtrando.
 */
export async function procesarTareas(page: Page, cliente: string) {
  while (true) {
    try {
      const taskId = await abrirSiguienteTarea(page);
      if (taskId) {
        await procesarPaginaDeTarea(page, taskId, cliente);
        await volverALaLista(page, cliente);
      }
    } catch (error) {
      console.error("Ocurrió un error inesperado:", error);
      await recuperarEstado(page, cliente);
    }
  }
}