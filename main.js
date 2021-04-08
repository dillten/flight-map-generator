const fs = require("fs");
const fsp = require("fs/promises");
const csv = require("neat-csv");
const readline = require("readline");
const stripBom = require("strip-bom");
const fastcsv = require('fast-csv');


// TODO: Fixed paths right now, to get the initial code out. Will make this dynamic later.
const airportDataFile = "data/airports.csv";
const logDataFile = process.argv[2] || "data/logbook.csv";
let airports = [];
let logbookFormat = {};

const go = async () => {
  airports = await getAirports();
  console.log(`Loaded airport directory, ${airports.length} airports found.`);

  logFormat = await detectLogbookFormat();
  console.log(`Detected logbook format of ${logFormat}.`);

  logData = await getLogbook(logFormat);
  console.log(`Loaded ForeFlight logbook, ${logData.length} flights found.`)

  mapData = await exportToKepler(logData);
  console.log(`Completed export to kepler.gl format at out.csv.`)
};

const exportToKepler = async (logData) => {
  // This does the work to reformat log data into the kepler.gl csv export.
  let kpd = [];
  for await (const el of logData) {
    kpd.push({
      from_lng: el.from.X,
      from_lat: el.from.Y,
      from_apt: el.from.NAME,
      from_apt_id: el.from.IDENT,
      to_lng: el.to.X,
      to_lat: el.to.Y,
      to_apt: el.to.NAME,
      to_apt_id: el.to.IDENT,
      log_date: el.log.date,
      log_timestamp: `${el.log.date} 00:00`,
      log_aircraft: el.log.aircraftId,
      log_route: el.log.route
    })
  }

  const ws = fs.createWriteStream("out.csv");
  fastcsv
    .write(kpd, { headers: true })
    .pipe(ws);

  return ('done');
};

const getAirports = async () => {
  const data = await fsp.readFile(airportDataFile, "utf-8");
  return csv(stripBom(data));
};

const getLogbook = async (logFormat) => {
  const fileStream = fs.createReadStream(logDataFile, 'utf-8');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let output = [];

  for await (const line of rl) {
    // Log Parsing Regex Switcher
    // TODO: Switch this to a csv parser, but will require editing the ForeFlight file to exclue the airplane info lines.
    // For now, the Garmin hack is a fixed length CSV regex that can probably be optimized further.
    // TODO: Also, this has a weird race condition if not evaluated each time. That needs to be fixed as well. 
    let re;
    if (logFormat == 'ForeFlight') {
      re = /^(?<date>\d{4}-\d{2}-\d{2}),(?<aircraftId>.*?),(?<from>.*?),(?<to>.*?),(?<route>.*?),.*,(?<comments>.*)/gi;
    } else if (logFormat == 'GarminPilot') {
      re = /^(?<date>\d{1,2}\/\d{1,2}\/\d{4}),(?<aircraftId>.*?),(([^,]*),){29}(?<from>[^,]*),(?<to>[^,]*),(?<route>[^,]*)/gi;
    }

    // Each line in input.txt will be successively available here as `line`.
    const parsed = re.exec(line);

    if (parsed) {
      // // Skipping an entry if either the from or to fields are empty strings.
      // if (parsed.groups.from !== '' && parsed.groups.to !== '') {

        // this is a valid logbook line, let's start iterating over the route
        const aptFrom = await airportLookup(parsed.groups.from);
        const aptTo = await airportLookup(parsed.groups.to);

        if (parsed.groups.route) {
          // we have a route, let's see if we can break it into parts
          rt = parsed.groups.route.split(/,| |-/g)
          rt = rt.filter(r => r);  // Remove any empty elements

          let routeSteps = [];
          for await (const el of rt) {
            const aptStep = await airportLookup(el);
            if (aptStep) { // Only add a routing step if we have an airport lookup success.
              // TODO: Fix where airport ID and VOR are the same. Either that, or enforce that all logbook entries use 'K' where applicable. MyFlightLog has this same issue.
              routeSteps.push(aptStep);
            }
          }

          routeSteps.unshift(aptFrom)
          routeSteps.push(aptTo)

          const routeCount = routeSteps.length;
          for (let index = 1; index < routeCount; index++) {
            o = {                               // Adding a route entry to the global flights array
              from: routeSteps[index - 1],
              to: routeSteps[index],
              log: parsed.groups
            }
            output.push(o);
          }
        } else {
          o = {
            from: aptFrom,
            to: aptTo,
            log: parsed.groups
          }
          output.push(o);
        }
      // }
    }
  }
  return output;
};

const detectLogbookFormat = async () => {
  const fileStream = fs.createReadStream(logDataFile, 'utf-8');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  // Search Strings per Log Type
  const reForeFlight = /^ForeFlight/gi
  const reGarminPilot = /^Date,Aircraft ID,Aircraft Type/gi

  for await (const line of rl) {
    const ff = reForeFlight.exec(line)
    const gp = reGarminPilot.exec(line)
    if (gp) { return ('GarminPilot') }
    if (ff) { return ('ForeFlight') }
  }
}

const airportLookup = async (airportId) => {
  return airports.find((el) => el.IDENT === airportId || el.ICAO_ID === airportId);
};

go();
