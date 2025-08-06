import { Stagehand, Page, BrowserContext } from "@browserbasehq/stagehand";
import StagehandConfig from "./stagehand.config.js";
import chalk from "chalk";
import boxen from "boxen";


import { login, filtrarPorCliente, procesarTareas } from "./utils.js";

/**
 * Procesa una tarea individual una vez que ha sido abierta.
 * Llama a la función de análisis de imágenes y muestra el resultado.
 * @param page - El objeto Page de Playwright.
 */
async function main({
  page,
  context: _context,
  stagehand: _stagehand,
}: {
  page: Page; 
  context: BrowserContext; 
  stagehand: Stagehand; 
}) {
  
  await page.goto("https://zombie-app.zubale.com/submissions/new");
  await login(page, "fraud.automation@zubale.com", "+('mN7b.j/dL/]Kx##"); 
  const cliente = "Liverpool Delivery Integracion";
  await filtrarPorCliente(page, cliente); 

  console.log("Esperando a que la página cargue después del filtro...");
  await page.waitForTimeout(2000); 

  await procesarTareas(page, cliente);
}

async function run() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
  });
  await stagehand.init();

  if (StagehandConfig.env === "BROWSERBASE" && stagehand.browserbaseSessionID) {
    console.log(
      boxen(
        `View this session live in your browser: \n${chalk.blue(
          `https://browserbase.com/sessions/${stagehand.browserbaseSessionID}`,
        )}`,
        {
          title: "Browserbase",
          padding: 1,
          margin: 3,
        },
      ),
    );
  }

  const page = stagehand.page;
  const context = stagehand.context;
  await main({
    page,
    context,
    stagehand,
  });
  await stagehand.close();
  stagehand.log({
    category: "create-browser-app",
    message: `\n🤘 Thanks so much for using Stagehand! Reach out to us on Slack if you have any feedback: ${chalk.blue(
      "https://stagehand.dev/slack",
    )}\n`,
  });
}

run();
