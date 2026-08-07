// Conversion UTM (WGS84) a lat/lon geograficas (fórmula inversa de Snyder, Transverse Mercator).
// Uso: window.utmToLatLon(easting, northing, zone, hemisphere)
//   zone: numero de zona UTM (1-60). zone negativa equivale a hemisferio 'S'.
//   hemisphere: 'N' o 'S' (por defecto 'S'). Ignorado si zone es negativo.
window.utmToLatLon = function(easting, northing, zone, hemisphere) {
    var a = 6378137.0;
    var f = 1 / 298.257223563;
    var ee = f * (2 - f);          // primera excentricidad al cuadrado
    var e2 = ee / (1 - ee);        // segunda excentricidad al cuadrado
    var k0 = 0.9996;

    if (zone < 0) { zone = -zone; hemisphere = 'S'; }
    hemisphere = (hemisphere || 'S').toUpperCase();

    var cm = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180; // meridiano central (rad)

    var x = easting - 500000;
    var y = northing;
    if (hemisphere === 'S') y = northing - 10000000;

    var M = y / k0;
    var raiz = Math.sqrt(1 - ee);
    var e1 = (1 - raiz) / (1 + raiz);

    var mu = M / (a * (1 - ee / 4 - 3 * ee * ee / 64 - 5 * ee * ee * ee / 256));

    var J1 = 3 * e1 / 2 - 27 * e1 * e1 * e1 / 32;
    var J2 = 21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32;
    var J3 = 151 * e1 * e1 * e1 / 96;
    var J4 = 1097 * e1 * e1 * e1 * e1 / 512;

    var phi1 = mu + J1 * Math.sin(2 * mu) + J2 * Math.sin(4 * mu) + J3 * Math.sin(6 * mu) + J4 * Math.sin(8 * mu);

    var sinPhi = Math.sin(phi1);
    var cosPhi = Math.cos(phi1);
    var tanPhi = Math.tan(phi1);
    var sin2 = sinPhi * sinPhi;

    var C1 = e2 * cosPhi * cosPhi;
    var T1 = tanPhi * tanPhi;
    var N1 = a / Math.sqrt(1 - ee * sin2);
    var R1 = a * (1 - ee) / Math.pow(1 - ee * sin2, 1.5);
    var D = x / (N1 * k0);

    var lat = phi1 - (N1 * tanPhi / R1) * (
        D * D / 2 -
        (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ee) * Math.pow(D, 4) / 24 +
        (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ee - 3 * C1 * C1) * Math.pow(D, 6) / 720
    );

    var lon = (D -
        (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6 +
        (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ee + 24 * T1 * T1) * Math.pow(D, 5) / 120
    ) / cosPhi;

    lon = lon + cm;

    return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
};
