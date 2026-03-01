//mkvextract   mkvinfo      mkvmerge     mkvpropedit
// const { exec } = import("child_process");
import { exec } from 'child_process'
import { parse, stringify } from 'lossless-json'

import { promisify } from 'util';
import { resolve } from 'path';
import fs from 'fs';
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const promiseExec = promisify(exec);
import readline from 'node:readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const prompt = msg => new Promise(resolve => 
  rl.question(msg, response => resolve(response))
);

const colors = {
    "reset": "\x1b[0m",
    "bright": "\x1b[1m",
    "dim": "\x1b[2m",
    "underscore": "\x1b[4m",
    "blink": "\x1b[5m",
    "reverse": "\x1b[7m",
    "hidden": "\x1b[8m",

    "fgBlack": "\x1b[30m",
    "fgRed": "\x1b[31m",
    "fgGreen": "\x1b[32m",
    "fgYellow": "\x1b[33m",
    "fgBlue": "\x1b[34m",
    "fgMagenta": "\x1b[35m",
    "fgCyan": "\x1b[36m",
    "fgWhite": "\x1b[37m",
    "fgGray": "\x1b[90m",

    "bgBlack": "\x1b[40m",
    "bgRed": "\x1b[41m",
    "bgGreen": "\x1b[42m",
    "bgYellow": "\x1b[43m",
    "bgBlue": "\x1b[44m",
    "bgMagenta": "\x1b[45m",
    "bgCyan": "\x1b[46m",
    "bgWhite": "\x1b[47m",
    "bgGray": "\x1b[100m",
}

var IS_TEST = process.argv[3] == 'test'
var TOTAL_FILES = 0
var TOTAL_SUBS = 0

index()

async function index() {
    let originFolder = process.argv[2]
    let destFolder = process.argv[3]

    if (!originFolder) {
        // console.log("Como usar el script")
        // console.log("1. Pasar como parametro la carpeta o el archivo")
        // console.log("   ej. node subs.js \"series/One Punch Man/Season 1\"")
        // console.log("   ej. node subs.js \"series/One Punch Man/Season 1/1x01.mkv\"")
        // console.log("El script debe estar en una carpeta superior a todas las series")
        // console.log("Se marcaran todos los subtitulos como por defecto 0 excepto:")
        // console.log("   Si tiene subtitulos en castillian se marca como 1");
        // console.log("   Si no tiene castillian pero tiene spanish se marca como 1")
        // console.log("   Si no tiene ningun subtitulo spa se marca el primero como 1")
        // console.log("Soporta rutas absolutas")
        return
    }

    let originFiles = await getFiles(originFolder)
    let destFiles = await getFiles(destFolder)
    console.log(originFiles)
    console.log(destFiles)
    swapSubs(originFiles, destFiles)
}

/**
 * Devuelve las rutas absolutas de los archivos de la carpera dir, si se pasa un
 * archivo se devuelve la ruta absoluta de ese archivo
 * @param   {string}    dir Directorio o archivo a modificar
 * @returns {Array}     Array con las rutas absolutas de los archivos
 * @example
 * // returns /home/user/folder/file.mkv
 * getFiles("folder");
 * @example
 * // returns /home/user/folder/file.mkv
 * getFiles("folder/file.mkv");
 */
async function getFiles(dir) {
    if (dir.match(/\.mkv$/)) {
        // si es ruta absoluta no se le concatena nada
        if (dir.match(/^\//)) {
            return [dir.replaceAll(/(?<!\\)"/g, '\\"')]
        }
        // si tiene " en la ruta se escapan
        return [import.meta.dirname + '/' + dir.replaceAll(/(?<!\\)"/g, '\\"')]
    }

    const subdirs = await readdir(dir);
    const files = await Promise.all(subdirs.map(async (subdir) => {
        const res = resolve(dir, subdir);

        if ((await stat(res)).isDirectory()) {
            return getFiles(res)
        }

        if (!res.match(/\.mkv$/)) {
            return null
        }

        return res.replaceAll(/(?<!\\)"/g, '\\"')
    }));
    return files.filter(e => e).reduce((a, f) => a.concat(f), []);
}

/**
 * Transpasa los subtitulos de un archivo a otro siguiendo el orten de la lista
 * @param   {Array}    originFiles  Lista de archivos origen con los subtitulos que se quieren copiar
 * @param   {Array}    destFiles    Lista de archivos destino a los que se les quieren copiar los subtitulos
 * @returns {Boolean}   Resultado de la ejecucion
 */
async function swapSubs(originFiles, destFiles) {
    if (originFiles.length !== destFiles.length) {
        console.error("La cantidad de archivos origen y destino no coincide");
        return false;
    }

    let keepOtherSubsFlag = null;
    let referenceSubTrack = null;

    try {
        for (let i = 0; i < originFiles.length; i++) {
            const originFile = originFiles[i];
            const destFile   = destFiles[i];

            console.log(`\nProcesando:\nOrigen: ${originFile}\nDestino: ${destFile}\n`);

            // Obtener info del origen
            const { stdout: originJson } = await promiseExec(
                `mkvmerge -J "${originFile}"`,
                { maxBuffer: 1024 * 1024 * 10 }
            );

            const originData = parse(originJson);
            const subtitleTracks = originData.tracks.filter(t => t.type === "subtitles");

            if (!subtitleTracks.length) {
                console.log("No hay subtítulos en el archivo origen. Saltando...");
                continue;
            }

            // Mostrar opciones solo la primera vez
            if (!referenceSubTrack) {
                const options = subtitleTracks.map(t =>
                    `${t.id}: ${t.properties.language || "und"} (${t.properties.language_ietf || "N/A"}) (${t.properties.track_name || "N/A"})`
                ).join("\n");

                let selectedId;
                do {
                    selectedId = await prompt(`${options}\nElige ID del subtítulo a transferir: `);
                } while (!subtitleTracks.some(t => String(t.id) === selectedId));

                referenceSubTrack = subtitleTracks.find(t => String(t.id) === selectedId);
            } else {
                // Buscar mismo idioma en siguientes archivos
                const match = subtitleTracks.find(t =>
                    t.properties.language === referenceSubTrack.properties.language &&
                    t.properties.language_ietf === referenceSubTrack.properties.language_ietf
                );

                if (!match) {
                    console.log("No se encontró subtítulo equivalente en este archivo. Saltando...");
                    continue;
                }

                referenceSubTrack = match;
            }

            // Preguntar solo una vez si mantener otros subtítulos
            if (keepOtherSubsFlag === null) {
                let answer;
                do {
                    answer = await prompt("¿Mantener otros subtítulos del destino? (y/n): ");
                } while (!["y", "n"].includes(answer));

                keepOtherSubsFlag = answer === "y";
            }

            // Construir comando mkvmerge
            const tempFile = `${destFile}.tmp.mkv`

            let command = `mkvmerge -o "${tempFile}" `

            // Del destino: mantener todo excepto subtítulos si el usuario dijo que no
            if (!keepOtherSubsFlag) {
                command += `--no-subtitles `
            }

            command += `"${destFile}" `

            // Del origen: solo el subtítulo seleccionado
            command += `--no-audio --no-video --no-attachments --no-chapters `
            command += `--subtitle-tracks ${referenceSubTrack.id} --default-track ${referenceSubTrack.id}:yes `
            command += `"${originFile}"`

            console.log("Ejecutando:", command);

            await promiseExec(command, { maxBuffer: 1024 * 1024 * 10 });

            // Reemplazar archivo original
            await promiseExec(`mv "${tempFile}" "${destFile}"`);

            console.log("Subtítulo transferido correctamente");
        }

        rl.close();
        return true;

    } catch (error) {
        console.error("STDERR:");
        console.error(error.stderr?.toString());
        console.error("ERROR:");
        console.error(error.message);
        rl.close();
        return false;
    }
}

function isInvalidPrompt(input, validOptions) {
    if (!validOptions.includes(input)) {
        console.log(`${colors.fgRed}Opción no valida, intenta de nuevo${colors.reset}`)
        return true
    }

    return false
}











/**
 * Escanea los subtitulos del mkv, marca todos a por defecto 0 excepto spanish
 * @param   {string}    file Comando a ejecutar si no se indica se usa el primero del queue
 * @returns {Boolean}   Resultado de la ejecucion
 */
function setDefaultSubs(file) {
    TOTAL_FILES++
    exec(`mkvmerge -J "${file}"`, {maxBuffer: undefined}, (error, stdout, stderr) => {
        if (error) {
            console.error(`error: ${error.message}`)
            return false
        }

        if (stderr) {
            console.error(`stderr: ${stderr}`)
            return false
        }

        // let mkvData        = parse(stdout)
        let subtitleTracks = mkvData.tracks.filter(e => e.type == 'subtitles')
        let hasCastillian  = subtitleTracks.find(e => e.properties.language_ietf == 'es-ES')
        let hasSpanish     = subtitleTracks.find(e => e.properties.language == 'spa')
        
        if (!subtitleTracks.length) {
            console.log("Skipped " + file)
            return false
        }

        let defaultTrack   = subtitleTracks[0].properties.uid.value;
        let commands       = []
        TOTAL_SUBS         += subtitleTracks.length
        if (IS_TEST) {
            console.log("Archivos: " + TOTAL_FILES + " Subtitulos: " + TOTAL_SUBS)
        }

        if (hasSpanish) {
            defaultTrack = hasSpanish.properties.uid.value
        }

        if (hasCastillian) {
            defaultTrack = hasCastillian.properties.uid.value
        }

        subtitleTracks.forEach(e => {
            let defaultVal = (defaultTrack == e.properties.uid.value ? 1 : 0)
            if (IS_TEST) {
                console.log(`mkvpropedit "${file}" -e track:=${e.properties.uid.value} --set flag-default=${defaultVal}`)
            }
            commands.push(`mkvpropedit "${file}" -e track:=${e.properties.uid.value} --set flag-default=${defaultVal}`)
        })

        if (!IS_TEST) {
            run(null, commands, file.replace(import.meta.dirname + '/', ''))
        }
    });
}

/**
 * Ejecuta una lista de comandos de forma ordenada y sincrona
 * @param   {string}    command     Comando a ejecutar si no se indica se usa el primero del queue
 * @param   {Array}     queue       Array con los comandos a ejecutar
 * @param   {string}    fileCounter Archivo al que se le va a ejecutar el comando
 * @returns {Boolean}   Resultado de la ejecucion
 */
function run(command, queue = [], file = null) {
    if (!command) {
        if (!queue.length) {
            console.error("no hay comandos a ejecutar")
            return false
        }
        command = queue.shift()
    }

    exec(command, {maxBuffer: undefined}, (error, stdout, stderr) => {
        if (error) {
            console.error(`error: ${error.message}`)
            return false
        }
        if (stderr) {
            console.error(`stderr: ${stderr}`)
            return false
        }

        console.log("commands left: " + queue.length + (file ? ' del archivo ' + file : ''))

        if (queue.length) {
            run(queue.shift(), queue, file)
        }
    })
    return true
}
