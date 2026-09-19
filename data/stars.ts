import type { CatalogStar } from "../lib/types.ts";

// Curated naked-eye stars. Coordinates are J2000 right ascension (hours) and declination (degrees).
export const BRIGHT_STARS: CatalogStar[] = [
  ["sirius", "Sirius", 6.7525, -16.7161, -1.46], ["canopus", "Canopus", 6.3992, -52.6957, -0.74],
  ["arcturus", "Arcturus", 14.261, 19.1824, -0.05], ["alpha-centauri", "Alpha Centauri", 14.66, -60.835, -0.27],
  ["vega", "Vega", 18.6156, 38.7837, 0.03], ["capella", "Capella", 5.2782, 45.998, 0.08],
  ["rigel", "Rigel", 5.2423, -8.2016, 0.13], ["procyon", "Procyon", 7.655, 5.225, 0.34],
  ["achernar", "Achernar", 1.6286, -57.2368, 0.46], ["betelgeuse", "Betelgeuse", 5.9195, 7.407, 0.42],
  ["hadar", "Hadar", 14.0637, -60.373, 0.61], ["altair", "Altair", 19.8464, 8.8683, 0.76],
  ["acrux", "Acrux", 12.4433, -63.0991, 0.77], ["aldebaran", "Aldebaran", 4.5987, 16.5093, 0.85],
  ["antares", "Antares", 16.4901, -26.432, 0.96], ["spica", "Spica", 13.4199, -11.1614, 0.98],
  ["pollux", "Pollux", 7.7553, 28.0262, 1.14], ["fomalhaut", "Fomalhaut", 22.9608, -29.6222, 1.16],
  ["deneb", "Deneb", 20.6905, 45.2803, 1.25], ["mimosa", "Mimosa", 12.7953, -59.6888, 1.25],
  ["regulus", "Regulus", 10.1395, 11.9672, 1.35], ["adhara", "Adhara", 6.9771, -28.9721, 1.5],
  ["castor", "Castor", 7.5767, 31.8883, 1.58], ["gacrux", "Gacrux", 12.5194, -57.1132, 1.63],
  ["bellatrix", "Bellatrix", 5.4189, 6.3497, 1.64], ["elnath", "Elnath", 5.4382, 28.6075, 1.65],
  ["miaplacidus", "Miaplacidus", 9.22, -69.7172, 1.67], ["alnilam", "Alnilam", 5.6036, -1.2019, 1.69],
  ["alnair", "Alnair", 22.1372, -46.961, 1.74], ["alnitak", "Alnitak", 5.6793, -1.9426, 1.74],
  ["alioth", "Alioth", 12.9005, 55.9598, 1.76], ["dubhe", "Dubhe", 11.0621, 61.7508, 1.79],
  ["mirfak", "Mirfak", 3.4054, 49.8612, 1.79], ["kaus-australis", "Kaus Australis", 18.4029, -34.3846, 1.79],
  ["wezen", "Wezen", 7.1399, -26.3932, 1.83], ["sargas", "Sargas", 17.6219, -42.9978, 1.86],
  ["avior", "Avior", 8.3752, -59.5095, 1.86], ["alkaid", "Alkaid", 13.7923, 49.3133, 1.86],
  ["menkalinan", "Menkalinan", 5.9921, 44.9474, 1.9], ["atria", "Atria", 16.8111, -69.0277, 1.91],
  ["alhena", "Alhena", 6.6285, 16.3993, 1.93], ["peacock", "Peacock", 20.4275, -56.7351, 1.94],
  ["mirzam", "Mirzam", 6.3783, -17.9559, 1.98], ["polaris", "Polaris", 2.5303, 89.2641, 1.98],
  ["hamal", "Hamal", 2.1196, 23.4624, 2], ["diphda", "Diphda", 0.7265, -17.9866, 2.04],
  ["nunki", "Nunki", 18.9211, -26.2967, 2.05], ["menkent", "Menkent", 14.1114, -36.37, 2.06],
  ["alpheratz", "Alpheratz", 0.1398, 29.0904, 2.06], ["rasalhague", "Rasalhague", 17.5822, 12.56, 2.07],
  ["kochab", "Kochab", 14.8451, 74.1555, 2.08]
].map(([id, name, ra, dec, magnitude]) => ({ id: String(id), name: String(name), ra: Number(ra), dec: Number(dec), magnitude: Number(magnitude) }));
