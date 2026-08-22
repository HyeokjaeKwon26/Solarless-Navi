/* nrel-spa 2.0.2 browser bundle. MIT and NREL SPA notices: ../THIRD_PARTY_NOTICES.md */
"use strict";
var NrelSpaCore = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // node_modules/nrel-spa/lib/spa.js
  var require_spa = __commonJS({
    "node_modules/nrel-spa/lib/spa.js"(exports) {
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.spa_calculate = exports.topocentric_azimuth_angle = exports.topocentric_azimuth_angle_astro = exports.topocentric_zenith_angle = exports.topocentric_elevation_angle_corrected = exports.atmospheric_refraction_correction = exports.topocentric_elevation_angle = exports.topocentric_local_hour_angle = exports.topocentric_right_ascension = exports.right_ascension_parallax_and_topocentric_dec = exports.observer_hour_angle = exports.geocentric_declination = exports.geocentric_right_ascension = exports.third_order_polynomial = exports.limit_degrees = exports.rad2deg = exports.deg2rad = exports.SpaData = exports.SPA_ALL = exports.SPA_ZA_RTS = exports.SPA_ZA_INC = exports.SPA_ZA = exports.OutCode = void 0;
      var OutCode;
      (function(OutCode2) {
        OutCode2[OutCode2["SPA_ZA"] = 0] = "SPA_ZA";
        OutCode2[OutCode2["SPA_ZA_INC"] = 1] = "SPA_ZA_INC";
        OutCode2[OutCode2["SPA_ZA_RTS"] = 2] = "SPA_ZA_RTS";
        OutCode2[OutCode2["SPA_ALL"] = 3] = "SPA_ALL";
      })(OutCode = exports.OutCode || (exports.OutCode = {}));
      exports.SPA_ZA = OutCode.SPA_ZA;
      exports.SPA_ZA_INC = OutCode.SPA_ZA_INC;
      exports.SPA_ZA_RTS = OutCode.SPA_ZA_RTS;
      exports.SPA_ALL = OutCode.SPA_ALL;
      var PI = Math.PI;
      var SUN_RADIUS = 0.26667;
      var L_COUNT = 6;
      var B_COUNT = 2;
      var R_COUNT = 5;
      var Y_COUNT = 63;
      var TermsA;
      (function(TermsA2) {
        TermsA2[TermsA2["TERM_A"] = 0] = "TERM_A";
        TermsA2[TermsA2["TERM_B"] = 1] = "TERM_B";
        TermsA2[TermsA2["TERM_C"] = 2] = "TERM_C";
        TermsA2[TermsA2["TERM_COUNT"] = 3] = "TERM_COUNT";
      })(TermsA || (TermsA = {}));
      var TermsX;
      (function(TermsX2) {
        TermsX2[TermsX2["TERM_X0"] = 0] = "TERM_X0";
        TermsX2[TermsX2["TERM_X1"] = 1] = "TERM_X1";
        TermsX2[TermsX2["TERM_X2"] = 2] = "TERM_X2";
        TermsX2[TermsX2["TERM_X3"] = 3] = "TERM_X3";
        TermsX2[TermsX2["TERM_X4"] = 4] = "TERM_X4";
        TermsX2[TermsX2["TERM_X_COUNT"] = 5] = "TERM_X_COUNT";
      })(TermsX || (TermsX = {}));
      var TermsPE;
      (function(TermsPE2) {
        TermsPE2[TermsPE2["TERM_PSI_A"] = 0] = "TERM_PSI_A";
        TermsPE2[TermsPE2["TERM_PSI_B"] = 1] = "TERM_PSI_B";
        TermsPE2[TermsPE2["TERM_EPS_C"] = 2] = "TERM_EPS_C";
        TermsPE2[TermsPE2["TERM_EPS_D"] = 3] = "TERM_EPS_D";
        TermsPE2[TermsPE2["TERM_PE_COUNT"] = 4] = "TERM_PE_COUNT";
      })(TermsPE || (TermsPE = {}));
      var JDSign;
      (function(JDSign2) {
        JDSign2[JDSign2["JD_MINUS"] = 0] = "JD_MINUS";
        JDSign2[JDSign2["JD_ZERO"] = 1] = "JD_ZERO";
        JDSign2[JDSign2["JD_PLUS"] = 2] = "JD_PLUS";
        JDSign2[JDSign2["JD_COUNT"] = 3] = "JD_COUNT";
      })(JDSign || (JDSign = {}));
      var SunState;
      (function(SunState2) {
        SunState2[SunState2["SUN_TRANSIT"] = 0] = "SUN_TRANSIT";
        SunState2[SunState2["SUN_RISE"] = 1] = "SUN_RISE";
        SunState2[SunState2["SUN_SET"] = 2] = "SUN_SET";
        SunState2[SunState2["SUN_COUNT"] = 3] = "SUN_COUNT";
      })(SunState || (SunState = {}));
      var TERM_Y_COUNT = TermsX.TERM_X_COUNT;
      var l_subcount = [64, 34, 20, 7, 3, 1];
      var b_subcount = [5, 2];
      var r_subcount = [40, 10, 6, 2, 1];
      var SpaData = (
        /** @class */
        /* @__PURE__ */ (function() {
          function SpaData2() {
            this.year = 0;
            this.month = 0;
            this.day = 0;
            this.hour = 0;
            this.minute = 0;
            this.second = 0;
            this.delta_ut1 = 0;
            this.delta_t = 0;
            this.timezone = 0;
            this.longitude = 0;
            this.latitude = 0;
            this.elevation = 0;
            this.pressure = 0;
            this.temperature = 0;
            this.slope = 0;
            this.azm_rotation = 0;
            this.atmos_refract = 0;
            this.function = 0;
            this.jd = 0;
            this.jc = 0;
            this.jde = 0;
            this.jce = 0;
            this.jme = 0;
            this.l = 0;
            this.b = 0;
            this.r = 0;
            this.theta = 0;
            this.beta = 0;
            this.x0 = 0;
            this.x1 = 0;
            this.x2 = 0;
            this.x3 = 0;
            this.x4 = 0;
            this.del_psi = 0;
            this.del_epsilon = 0;
            this.epsilon0 = 0;
            this.epsilon = 0;
            this.del_tau = 0;
            this.lamda = 0;
            this.nu0 = 0;
            this.nu = 0;
            this.alpha = 0;
            this.delta = 0;
            this.h = 0;
            this.xi = 0;
            this.del_alpha = 0;
            this.delta_prime = 0;
            this.alpha_prime = 0;
            this.h_prime = 0;
            this.e0 = 0;
            this.del_e = 0;
            this.e = 0;
            this.eot = 0;
            this.srha = 0;
            this.ssha = 0;
            this.sta = 0;
            this.zenith = 0;
            this.azimuth_astro = 0;
            this.azimuth = 0;
            this.incidence = 0;
            this.suntransit = 0;
            this.sunrise = 0;
            this.sunset = 0;
          }
          return SpaData2;
        })()
      );
      exports.SpaData = SpaData;
      var copySPA = function(src) {
        return Array.isArray(src) ? src.map(function(i) {
          return copySPA(i);
        }) : typeof src === "object" ? Object.getOwnPropertyNames(src).reduce(function(o, prop) {
          Object.defineProperty(o, prop, Object.getOwnPropertyDescriptor(src, prop));
          o[prop] = copySPA(src[prop]);
          return o;
        }, Object.create(Object.getPrototypeOf(src))) : src;
      };
      var L_TERMS = [
        [
          [175347046, 0, 0],
          [3341656, 4.6692568, 6283.07585],
          [34894, 4.6261, 12566.1517],
          [3497, 2.7441, 5753.3849],
          [3418, 2.8289, 3.5231],
          [3136, 3.6277, 77713.7715],
          [2676, 4.4181, 7860.4194],
          [2343, 6.1352, 3930.2097],
          [1324, 0.7425, 11506.7698],
          [1273, 2.0371, 529.691],
          [1199, 1.1096, 1577.3435],
          [990, 5.233, 5884.927],
          [902, 2.045, 26.298],
          [857, 3.508, 398.149],
          [780, 1.179, 5223.694],
          [753, 2.533, 5507.553],
          [505, 4.583, 18849.228],
          [492, 4.205, 775.523],
          [357, 2.92, 0.067],
          [317, 5.849, 11790.629],
          [284, 1.899, 796.298],
          [271, 0.315, 10977.079],
          [243, 0.345, 5486.778],
          [206, 4.806, 2544.314],
          [205, 1.869, 5573.143],
          [202, 2.458, 6069.777],
          [156, 0.833, 213.299],
          [132, 3.411, 2942.463],
          [126, 1.083, 20.775],
          [115, 0.645, 0.98],
          [103, 0.636, 4694.003],
          [102, 0.976, 15720.839],
          [102, 4.267, 7.114],
          [99, 6.21, 2146.17],
          [98, 0.68, 155.42],
          [86, 5.98, 161000.69],
          [85, 1.3, 6275.96],
          [85, 3.67, 71430.7],
          [80, 1.81, 17260.15],
          [79, 3.04, 12036.46],
          [75, 1.76, 5088.63],
          [74, 3.5, 3154.69],
          [74, 4.68, 801.82],
          [70, 0.83, 9437.76],
          [62, 3.98, 8827.39],
          [61, 1.82, 7084.9],
          [57, 2.78, 6286.6],
          [56, 4.39, 14143.5],
          [56, 3.47, 6279.55],
          [52, 0.19, 12139.55],
          [52, 1.33, 1748.02],
          [51, 0.28, 5856.48],
          [49, 0.49, 1194.45],
          [41, 5.37, 8429.24],
          [41, 2.4, 19651.05],
          [39, 6.17, 10447.39],
          [37, 6.04, 10213.29],
          [37, 2.57, 1059.38],
          [36, 1.71, 2352.87],
          [36, 1.78, 6812.77],
          [33, 0.59, 17789.85],
          [30, 0.44, 83996.85],
          [30, 2.74, 1349.87],
          [25, 3.16, 4690.48]
        ],
        [
          [628331966747, 0, 0],
          [206059, 2.678235, 6283.07585],
          [4303, 2.6351, 12566.1517],
          [425, 1.59, 3.523],
          [119, 5.796, 26.298],
          [109, 2.966, 1577.344],
          [93, 2.59, 18849.23],
          [72, 1.14, 529.69],
          [68, 1.87, 398.15],
          [67, 4.41, 5507.55],
          [59, 2.89, 5223.69],
          [56, 2.17, 155.42],
          [45, 0.4, 796.3],
          [36, 0.47, 775.52],
          [29, 2.65, 7.11],
          [21, 5.34, 0.98],
          [19, 1.85, 5486.78],
          [19, 4.97, 213.3],
          [17, 2.99, 6275.96],
          [16, 0.03, 2544.31],
          [16, 1.43, 2146.17],
          [15, 1.21, 10977.08],
          [12, 2.83, 1748.02],
          [12, 3.26, 5088.63],
          [12, 5.27, 1194.45],
          [12, 2.08, 4694],
          [11, 0.77, 553.57],
          [10, 1.3, 6286.6],
          [10, 4.24, 1349.87],
          [9, 2.7, 242.73],
          [9, 5.64, 951.72],
          [8, 5.3, 2352.87],
          [6, 2.65, 9437.76],
          [6, 4.67, 4690.48]
        ],
        [
          [52919, 0, 0],
          [8720, 1.0721, 6283.0758],
          [309, 0.867, 12566.152],
          [27, 0.05, 3.52],
          [16, 5.19, 26.3],
          [16, 3.68, 155.42],
          [10, 0.76, 18849.23],
          [9, 2.06, 77713.77],
          [7, 0.83, 775.52],
          [5, 4.66, 1577.34],
          [4, 1.03, 7.11],
          [4, 3.44, 5573.14],
          [3, 5.14, 796.3],
          [3, 6.05, 5507.55],
          [3, 1.19, 242.73],
          [3, 6.12, 529.69],
          [3, 0.31, 398.15],
          [3, 2.28, 553.57],
          [2, 4.38, 5223.69],
          [2, 3.75, 0.98]
        ],
        [
          [289, 5.844, 6283.076],
          [35, 0, 0],
          [17, 5.49, 12566.15],
          [3, 5.2, 155.42],
          [1, 4.72, 3.52],
          [1, 5.3, 18849.23],
          [1, 5.97, 242.73]
        ],
        [
          [114, 3.142, 0],
          [8, 4.13, 6283.08],
          [1, 3.84, 12566.15]
        ],
        [
          [1, 3.14, 0]
        ]
      ];
      var B_TERMS = [
        [
          [280, 3.199, 84334.662],
          [102, 5.422, 5507.553],
          [80, 3.88, 5223.69],
          [44, 3.7, 2352.87],
          [32, 4, 1577.34]
        ],
        [
          [9, 3.9, 5507.55],
          [6, 1.73, 5223.69]
        ]
      ];
      var R_TERMS = [
        [
          [100013989, 0, 0],
          [1670700, 3.0984635, 6283.07585],
          [13956, 3.05525, 12566.1517],
          [3084, 5.1985, 77713.7715],
          [1628, 1.1739, 5753.3849],
          [1576, 2.8469, 7860.4194],
          [925, 5.453, 11506.77],
          [542, 4.564, 3930.21],
          [472, 3.661, 5884.927],
          [346, 0.964, 5507.553],
          [329, 5.9, 5223.694],
          [307, 0.299, 5573.143],
          [243, 4.273, 11790.629],
          [212, 5.847, 1577.344],
          [186, 5.022, 10977.079],
          [175, 3.012, 18849.228],
          [110, 5.055, 5486.778],
          [98, 0.89, 6069.78],
          [86, 5.69, 15720.84],
          [86, 1.27, 161000.69],
          [65, 0.27, 17260.15],
          [63, 0.92, 529.69],
          [57, 2.01, 83996.85],
          [56, 5.24, 71430.7],
          [49, 3.25, 2544.31],
          [47, 2.58, 775.52],
          [45, 5.54, 9437.76],
          [43, 6.01, 6275.96],
          [39, 5.36, 4694],
          [38, 2.39, 8827.39],
          [37, 0.83, 19651.05],
          [37, 4.9, 12139.55],
          [36, 1.67, 12036.46],
          [35, 1.84, 2942.46],
          [33, 0.24, 7084.9],
          [32, 0.18, 5088.63],
          [32, 1.78, 398.15],
          [28, 1.21, 6286.6],
          [28, 1.9, 6279.55],
          [26, 4.59, 10447.39]
        ],
        [
          [103019, 1.10749, 6283.07585],
          [1721, 1.0644, 12566.1517],
          [702, 3.142, 0],
          [32, 1.02, 18849.23],
          [31, 2.84, 5507.55],
          [25, 1.32, 5223.69],
          [18, 1.42, 1577.34],
          [10, 5.91, 10977.08],
          [9, 1.42, 6275.96],
          [9, 0.27, 5486.78]
        ],
        [
          [4359, 5.7846, 6283.0758],
          [124, 5.579, 12566.152],
          [12, 3.14, 0],
          [9, 3.63, 77713.77],
          [6, 1.87, 5573.14],
          [3, 5.47, 18849.23]
        ],
        [
          [145, 4.273, 6283.076],
          [7, 3.92, 12566.15]
        ],
        [
          [4, 2.56, 6283.08]
        ]
      ];
      var Y_TERMS = [
        [0, 0, 0, 0, 1],
        [-2, 0, 0, 2, 2],
        [0, 0, 0, 2, 2],
        [0, 0, 0, 0, 2],
        [0, 1, 0, 0, 0],
        [0, 0, 1, 0, 0],
        [-2, 1, 0, 2, 2],
        [0, 0, 0, 2, 1],
        [0, 0, 1, 2, 2],
        [-2, -1, 0, 2, 2],
        [-2, 0, 1, 0, 0],
        [-2, 0, 0, 2, 1],
        [0, 0, -1, 2, 2],
        [2, 0, 0, 0, 0],
        [0, 0, 1, 0, 1],
        [2, 0, -1, 2, 2],
        [0, 0, -1, 0, 1],
        [0, 0, 1, 2, 1],
        [-2, 0, 2, 0, 0],
        [0, 0, -2, 2, 1],
        [2, 0, 0, 2, 2],
        [0, 0, 2, 2, 2],
        [0, 0, 2, 0, 0],
        [-2, 0, 1, 2, 2],
        [0, 0, 0, 2, 0],
        [-2, 0, 0, 2, 0],
        [0, 0, -1, 2, 1],
        [0, 2, 0, 0, 0],
        [2, 0, -1, 0, 1],
        [-2, 2, 0, 2, 2],
        [0, 1, 0, 0, 1],
        [-2, 0, 1, 0, 1],
        [0, -1, 0, 0, 1],
        [0, 0, 2, -2, 0],
        [2, 0, -1, 2, 1],
        [2, 0, 1, 2, 2],
        [0, 1, 0, 2, 2],
        [-2, 1, 1, 0, 0],
        [0, -1, 0, 2, 2],
        [2, 0, 0, 2, 1],
        [2, 0, 1, 0, 0],
        [-2, 0, 2, 2, 2],
        [-2, 0, 1, 2, 1],
        [2, 0, -2, 0, 1],
        [2, 0, 0, 0, 1],
        [0, -1, 1, 0, 0],
        [-2, -1, 0, 2, 1],
        [-2, 0, 0, 0, 1],
        [0, 0, 2, 2, 1],
        [-2, 0, 2, 0, 1],
        [-2, 1, 0, 2, 1],
        [0, 0, 1, -2, 0],
        [-1, 0, 1, 0, 0],
        [-2, 1, 0, 0, 0],
        [1, 0, 0, 0, 0],
        [0, 0, 1, 2, 0],
        [0, 0, -2, 2, 2],
        [-1, -1, 1, 0, 0],
        [0, 1, 1, 0, 0],
        [0, -1, 1, 2, 2],
        [2, -1, -1, 2, 2],
        [0, 0, 3, 2, 2],
        [2, -1, 0, 2, 2]
      ];
      var PE_TERMS = [
        [-171996, -174.2, 92025, 8.9],
        [-13187, -1.6, 5736, -3.1],
        [-2274, -0.2, 977, -0.5],
        [2062, 0.2, -895, 0.5],
        [1426, -3.4, 54, -0.1],
        [712, 0.1, -7, 0],
        [-517, 1.2, 224, -0.6],
        [-386, -0.4, 200, 0],
        [-301, 0, 129, -0.1],
        [217, -0.5, -95, 0.3],
        [-158, 0, 0, 0],
        [129, 0.1, -70, 0],
        [123, 0, -53, 0],
        [63, 0, 0, 0],
        [63, 0.1, -33, 0],
        [-59, 0, 26, 0],
        [-58, -0.1, 32, 0],
        [-51, 0, 27, 0],
        [48, 0, 0, 0],
        [46, 0, -24, 0],
        [-38, 0, 16, 0],
        [-31, 0, 13, 0],
        [29, 0, 0, 0],
        [29, 0, -12, 0],
        [26, 0, 0, 0],
        [-22, 0, 0, 0],
        [21, 0, -10, 0],
        [17, -0.1, 0, 0],
        [16, 0, -8, 0],
        [-16, 0.1, 7, 0],
        [-15, 0, 9, 0],
        [-13, 0, 7, 0],
        [-12, 0, 6, 0],
        [11, 0, 0, 0],
        [-10, 0, 5, 0],
        [-8, 0, 3, 0],
        [7, 0, -3, 0],
        [-7, 0, 0, 0],
        [-7, 0, 3, 0],
        [-7, 0, 3, 0],
        [6, 0, 0, 0],
        [6, 0, -3, 0],
        [6, 0, -3, 0],
        [-6, 0, 3, 0],
        [-6, 0, 3, 0],
        [5, 0, 0, 0],
        [-5, 0, 3, 0],
        [-5, 0, 3, 0],
        [-5, 0, 3, 0],
        [4, 0, 0, 0],
        [4, 0, 0, 0],
        [4, 0, 0, 0],
        [-4, 0, 0, 0],
        [-4, 0, 0, 0],
        [-4, 0, 0, 0],
        [3, 0, 0, 0],
        [-3, 0, 0, 0],
        [-3, 0, 0, 0],
        [-3, 0, 0, 0],
        [-3, 0, 0, 0],
        [-3, 0, 0, 0],
        [-3, 0, 0, 0],
        [-3, 0, 0, 0]
      ];
      function deg2rad(degrees) {
        return PI / 180 * degrees;
      }
      exports.deg2rad = deg2rad;
      function rad2deg(radians) {
        return 180 / PI * radians;
      }
      exports.rad2deg = rad2deg;
      function limit_degrees(degrees) {
        degrees /= 360;
        var limited = 360 * (degrees - Math.floor(degrees));
        if (limited < 0) {
          limited += 360;
        }
        return limited;
      }
      exports.limit_degrees = limit_degrees;
      function third_order_polynomial(a, b, c, d, x) {
        return (a * x + b + c) * x + d;
      }
      exports.third_order_polynomial = third_order_polynomial;
      function geocentric_right_ascension(lamda, epsilon, beta) {
        var lambdaRad = deg2rad(lamda);
        var epsilonRad = deg2rad(epsilon);
        return limit_degrees(rad2deg(Math.atan2(Math.sin(lambdaRad) * Math.cos(epsilonRad) - Math.tan(deg2rad(beta)) * Math.sin(epsilonRad), Math.cos(lambdaRad))));
      }
      exports.geocentric_right_ascension = geocentric_right_ascension;
      function geocentric_declination(beta, epsilon, lamda) {
        var betaRad = deg2rad(beta);
        var epsilonRad = deg2rad(epsilon);
        return rad2deg(Math.asin(Math.sin(betaRad) * Math.cos(epsilonRad) + Math.cos(betaRad) * Math.sin(epsilonRad) * Math.sin(deg2rad(lamda))));
      }
      exports.geocentric_declination = geocentric_declination;
      function observer_hour_angle(nu, longitude, alpha_deg) {
        return limit_degrees(nu + longitude - alpha_deg);
      }
      exports.observer_hour_angle = observer_hour_angle;
      function right_ascension_parallax_and_topocentric_dec(latitude, elevation, xi, h, delta, dltap) {
        var delta_alpha_rad = 0;
        var lat_rad = deg2rad(latitude);
        var xi_rad = deg2rad(xi);
        var h_rad = deg2rad(h);
        var delta_rad = deg2rad(delta);
        var u = Math.atan(0.99664719 * Math.tan(lat_rad));
        var y = 0.99664719 * Math.sin(u) + elevation * Math.sin(lat_rad) / 6378140;
        var x = Math.cos(u) + elevation * Math.cos(lat_rad) / 6378140;
        delta_alpha_rad = Math.atan2(-x * Math.sin(xi_rad) * Math.sin(h_rad), Math.cos(delta_rad) - x * Math.sin(xi_rad) * Math.cos(h_rad));
        dltap.delta_prime = rad2deg(Math.atan2((Math.sin(delta_rad) - y * Math.sin(xi_rad)) * Math.cos(delta_alpha_rad), Math.cos(delta_rad) - x * Math.sin(xi_rad) * Math.cos(h_rad)));
        dltap.delta_alpha = rad2deg(delta_alpha_rad);
      }
      exports.right_ascension_parallax_and_topocentric_dec = right_ascension_parallax_and_topocentric_dec;
      function topocentric_right_ascension(alpha_deg, delta_alpha) {
        return alpha_deg + delta_alpha;
      }
      exports.topocentric_right_ascension = topocentric_right_ascension;
      function topocentric_local_hour_angle(h, delta_alpha) {
        return h - delta_alpha;
      }
      exports.topocentric_local_hour_angle = topocentric_local_hour_angle;
      function topocentric_elevation_angle(latitude, delta_prime, h_prime) {
        var latRad = deg2rad(latitude);
        var deltaPrimeRad = deg2rad(delta_prime);
        return rad2deg(Math.asin(Math.sin(latRad) * Math.sin(deltaPrimeRad) + Math.cos(latRad) * Math.cos(deltaPrimeRad) * Math.cos(deg2rad(h_prime))));
      }
      exports.topocentric_elevation_angle = topocentric_elevation_angle;
      function atmospheric_refraction_correction(pressure, temperature, atmos_refract, e0) {
        var delE = 0;
        if (e0 >= -1 * (SUN_RADIUS + atmos_refract))
          delE = pressure / 1010 * (283 / (273 + temperature)) * 1.02 / (60 * Math.tan(deg2rad(e0 + 10.3 / (e0 + 5.11))));
        return delE;
      }
      exports.atmospheric_refraction_correction = atmospheric_refraction_correction;
      function topocentric_elevation_angle_corrected(e0, delta_e) {
        return e0 + delta_e;
      }
      exports.topocentric_elevation_angle_corrected = topocentric_elevation_angle_corrected;
      function topocentric_zenith_angle(e) {
        return 90 - e;
      }
      exports.topocentric_zenith_angle = topocentric_zenith_angle;
      function topocentric_azimuth_angle_astro(h_prime, latitude, delta_prime) {
        var h_prime_rad = deg2rad(h_prime);
        var lat_rad = deg2rad(latitude);
        return limit_degrees(rad2deg(Math.atan2(Math.sin(h_prime_rad), Math.cos(h_prime_rad) * Math.sin(lat_rad) - Math.tan(deg2rad(delta_prime)) * Math.cos(lat_rad))));
      }
      exports.topocentric_azimuth_angle_astro = topocentric_azimuth_angle_astro;
      function topocentric_azimuth_angle(azimuth_astro) {
        return limit_degrees(azimuth_astro + 180);
      }
      exports.topocentric_azimuth_angle = topocentric_azimuth_angle;
      function integer(val) {
        return Math.floor(val);
      }
      function validate_inputs(spa) {
        if (spa.year < -2e3 || spa.year > 6e3)
          return 1;
        if (spa.month < 1 || spa.month > 12)
          return 2;
        if (spa.day < 1 || spa.day > 31)
          return 3;
        if (spa.hour < 0 || spa.hour > 24)
          return 4;
        if (spa.minute < 0 || spa.minute > 59)
          return 5;
        if (spa.second < 0 || spa.second >= 60)
          return 6;
        if (spa.pressure < 0 || spa.pressure > 5e3)
          return 12;
        if (spa.temperature <= -273 || spa.temperature > 6e3)
          return 13;
        if (spa.delta_ut1 <= -1 || spa.delta_ut1 >= 1)
          return 17;
        if (spa.hour == 24 && spa.minute > 0)
          return 5;
        if (spa.hour == 24 && spa.second > 0)
          return 6;
        if (Math.abs(spa.delta_t) > 8e3)
          return 7;
        if (Math.abs(spa.timezone) > 18)
          return 8;
        if (Math.abs(spa.longitude) > 180)
          return 9;
        if (Math.abs(spa.latitude) > 90)
          return 10;
        if (Math.abs(spa.atmos_refract) > 5)
          return 16;
        if (spa.elevation < -65e5)
          return 11;
        return 0;
      }
      function julian_day(year, month, day, hour, minute, second, dut1, tz) {
        var day_decimal = 0;
        var julian_day2 = 0;
        var a = 0;
        day_decimal = day + (hour - tz + (minute + (second + dut1) / 60) / 60) / 24;
        if (month < 3) {
          month += 12;
          year--;
        }
        julian_day2 = integer(365.25 * (year + 4716)) + integer(30.6001 * (month + 1)) + day_decimal - 1524.5;
        if (julian_day2 > 2299160) {
          a = integer(year / 100);
          julian_day2 += 2 - a + integer(a / 4);
        }
        return julian_day2;
      }
      function julian_century(jd) {
        return (jd - 2451545) / 36525;
      }
      function mean_elongation_moon_sun(jce) {
        return third_order_polynomial(1 / 189474, -19142e-7, 445267.11148, 297.85036, jce);
      }
      function julian_ephemeris_day(jd, delta_t) {
        return jd + delta_t / 86400;
      }
      function julian_ephemeris_century(jde) {
        return (jde - 2451545) / 36525;
      }
      function julian_ephemeris_millennium(jce) {
        return jce / 10;
      }
      function earth_periodic_term_summation(terms, count, jme) {
        var sum = 0;
        for (var i = 0; i < count; i++)
          sum += terms[i][TermsA.TERM_A] * Math.cos(terms[i][TermsA.TERM_B] + terms[i][TermsA.TERM_C] * jme);
        return sum;
      }
      function earth_values(term_sum, count, jme) {
        var sum = 0;
        for (var i = 0; i < count; i++)
          sum += term_sum[i] * Math.pow(jme, i);
        sum /= 1e8;
        return sum;
      }
      function earth_heliocentric_longitude(jme) {
        var sum = [];
        for (var i = 0; i < L_COUNT; i++)
          sum[i] = earth_periodic_term_summation(L_TERMS[i], l_subcount[i], jme);
        return limit_degrees(rad2deg(earth_values(sum, L_COUNT, jme)));
      }
      function earth_heliocentric_latitude(jme) {
        var sum = [];
        for (var i = 0; i < B_COUNT; i++)
          sum[i] = earth_periodic_term_summation(B_TERMS[i], b_subcount[i], jme);
        return rad2deg(earth_values(sum, B_COUNT, jme));
      }
      function earth_radius_vector(jme) {
        var sum = [];
        for (var i = 0; i < R_COUNT; i++)
          sum[i] = earth_periodic_term_summation(R_TERMS[i], r_subcount[i], jme);
        return earth_values(sum, R_COUNT, jme);
      }
      function geocentric_longitude(l) {
        var theta = l + 180;
        if (theta >= 360)
          theta -= 360;
        return theta;
      }
      function geocentric_latitude(b) {
        return -b;
      }
      function mean_anomaly_sun(jce) {
        return third_order_polynomial(-1 / 3e5, -1603e-7, 35999.05034, 357.52772, jce);
      }
      function mean_anomaly_moon(jce) {
        return third_order_polynomial(1 / 56250, 86972e-7, 477198.867398, 134.96298, jce);
      }
      function argument_latitude_moon(jce) {
        return third_order_polynomial(1 / 327270, -36825e-7, 483202.017538, 93.27191, jce);
      }
      function ascending_longitude_moon(jce) {
        return third_order_polynomial(1 / 45e4, 20708e-7, -1934.136261, 125.04452, jce);
      }
      function xy_term_summation(i, x) {
        var sum = 0;
        for (var j = 0; j < TERM_Y_COUNT; j++)
          sum += x[j] * Y_TERMS[i][j];
        return sum;
      }
      function nutation_longitude_and_obliquity(jce, x, spa) {
        var xy_term_sum;
        var sum_psi = 0;
        var sum_epsilon = 0;
        for (var i = 0; i < Y_COUNT; i++) {
          xy_term_sum = deg2rad(xy_term_summation(i, x));
          sum_psi += (PE_TERMS[i][TermsPE.TERM_PSI_A] + jce * PE_TERMS[i][TermsPE.TERM_PSI_B]) * Math.sin(xy_term_sum);
          sum_epsilon += (PE_TERMS[i][TermsPE.TERM_EPS_C] + jce * PE_TERMS[i][TermsPE.TERM_EPS_D]) * Math.cos(xy_term_sum);
        }
        spa.del_psi = sum_psi / 36e6;
        spa.del_epsilon = sum_epsilon / 36e6;
      }
      function ecliptic_mean_obliquity(jme) {
        var u = jme / 10;
        return 84381.448 + u * (-4680.93 + u * (-1.55 + u * (1999.25 + u * (-51.38 + u * (-249.67 + u * (-39.05 + u * (7.12 + u * (27.87 + u * (5.79 + u * 2.45)))))))));
      }
      function ecliptic_true_obliquity(delta_epsilon, epsilon0) {
        return delta_epsilon + epsilon0 / 3600;
      }
      function aberration_correction(r) {
        return -20.4898 / (3600 * r);
      }
      function apparent_sun_longitude(theta, delta_psi, delta_tau) {
        return theta + delta_psi + delta_tau;
      }
      function greenwich_mean_sidereal_time(jd, jc) {
        return limit_degrees(280.46061837 + 360.98564736629 * (jd - 2451545) + jc * jc * (387933e-9 - jc / 3871e4));
      }
      function greenwich_sidereal_time(nu0, delta_psi, epsilon) {
        return nu0 + delta_psi * Math.cos(deg2rad(epsilon));
      }
      function sun_equatorial_horizontal_parallax(r) {
        return 8.794 / (3600 * r);
      }
      function surface_incidence_angle(zenith, azimuth_astro, azm_rotation, slope) {
        var zenith_rad = deg2rad(zenith);
        var slope_rad = deg2rad(slope);
        return rad2deg(Math.acos(Math.cos(zenith_rad) * Math.cos(slope_rad) + Math.sin(slope_rad) * Math.sin(zenith_rad) * Math.cos(deg2rad(azimuth_astro - azm_rotation))));
      }
      function sun_mean_longitude(jme) {
        return limit_degrees(280.4664567 + jme * (360007.6982779 + jme * (0.03032028 + jme * (1 / 49931 + jme * (-1 / 15300 + jme * (-1 / 2e6))))));
      }
      function limit_minutes(minutes) {
        var limited = minutes;
        if (limited < -20)
          limited += 1440;
        else if (limited > 20)
          limited -= 1440;
        return limited;
      }
      function eot(m, alpha, del_psi, epsilon) {
        return limit_minutes(4 * (m - 57183e-7 - alpha + del_psi * Math.cos(deg2rad(epsilon))));
      }
      function approx_sun_transit_time(alpha_zero, longitude, nu) {
        return (alpha_zero - longitude - nu) / 360;
      }
      function sun_hour_angle_at_rise_set(latitude, delta_zero, h0_prime) {
        var h0 = -99999;
        var latitude_rad = deg2rad(latitude);
        var delta_zero_rad = deg2rad(delta_zero);
        var argument = (Math.sin(deg2rad(h0_prime)) - Math.sin(latitude_rad) * Math.sin(delta_zero_rad)) / (Math.cos(latitude_rad) * Math.cos(delta_zero_rad));
        if (Math.abs(argument) <= 1)
          h0 = limit_degrees180(rad2deg(Math.acos(argument)));
        return h0;
      }
      function limit_zero2one(value) {
        var limited = value - Math.floor(value);
        if (limited < 0)
          limited += 1;
        return limited;
      }
      function approx_sun_rise_and_set(m_rts, h0) {
        var h0_dfrac = h0 / 360;
        m_rts[SunState.SUN_RISE] = limit_zero2one(m_rts[SunState.SUN_TRANSIT] - h0_dfrac);
        m_rts[SunState.SUN_SET] = limit_zero2one(m_rts[SunState.SUN_TRANSIT] + h0_dfrac);
        m_rts[SunState.SUN_TRANSIT] = limit_zero2one(m_rts[SunState.SUN_TRANSIT]);
      }
      function rts_alpha_delta_prime(ad, n) {
        var a = ad[JDSign.JD_ZERO] - ad[JDSign.JD_MINUS];
        var b = ad[JDSign.JD_PLUS] - ad[JDSign.JD_ZERO];
        if (Math.abs(a) >= 2)
          a = limit_zero2one(a);
        if (Math.abs(b) >= 2)
          b = limit_zero2one(b);
        return ad[JDSign.JD_ZERO] + n * (a + b + (b - a) * n) / 2;
      }
      function limit_degrees180pm(degrees) {
        var limited;
        degrees /= 360;
        limited = 360 * (degrees - Math.floor(degrees));
        if (limited < -180)
          limited += 360;
        else if (limited > 180)
          limited -= 360;
        return limited;
      }
      function limit_degrees180(degrees) {
        var limited;
        degrees /= 180;
        limited = 180 * (degrees - Math.floor(degrees));
        if (limited < 0)
          limited += 180;
        return limited;
      }
      function rts_sun_altitude(latitude, delta_prime, h_prime) {
        var latitude_rad = deg2rad(latitude);
        var delta_prime_rad = deg2rad(delta_prime);
        return rad2deg(Math.asin(Math.sin(latitude_rad) * Math.sin(delta_prime_rad) + Math.cos(latitude_rad) * Math.cos(delta_prime_rad) * Math.cos(deg2rad(h_prime))));
      }
      function sun_rise_and_set(m_rts, h_rts, delta_prime, latitude, h_prime, h0_prime, sun) {
        return m_rts[sun] + (h_rts[sun] - h0_prime) / (360 * Math.cos(deg2rad(delta_prime[sun])) * Math.cos(deg2rad(latitude)) * Math.sin(deg2rad(h_prime[sun])));
      }
      function dayfrac_to_local_hr(dayfrac, timezone) {
        return 24 * limit_zero2one(dayfrac + timezone / 24);
      }
      function calculate_eot_and_sun_rise_transit_set(spa) {
        var nu = 0;
        var m = 0;
        var h0 = 0;
        var n = 0;
        var alpha = [];
        var delta = [];
        var m_rts = [];
        var nu_rts = [];
        var h_rts = [];
        var alpha_prime = [];
        var delta_prime = [];
        var h_prime = [];
        var h0_prime = -1 * (SUN_RADIUS + spa.atmos_refract);
        var sun_rts = copySPA(spa);
        sun_rts.hour = sun_rts.minute = sun_rts.second = 0;
        sun_rts.delta_ut1 = sun_rts.timezone = 0;
        sun_rts.jd = julian_day(sun_rts.year, sun_rts.month, sun_rts.day, sun_rts.hour, sun_rts.minute, sun_rts.second, sun_rts.delta_ut1, sun_rts.timezone);
        m = sun_mean_longitude(spa.jme);
        spa.eot = eot(m, spa.alpha, spa.del_psi, spa.epsilon);
        calculate_geocentric_sun_right_ascension_and_declination(sun_rts);
        nu = sun_rts.nu;
        sun_rts.delta_t = 0;
        sun_rts.jd--;
        for (var i = 0; i < JDSign.JD_COUNT; i++) {
          calculate_geocentric_sun_right_ascension_and_declination(sun_rts);
          alpha[i] = sun_rts.alpha;
          delta[i] = sun_rts.delta;
          sun_rts.jd++;
        }
        m_rts[SunState.SUN_TRANSIT] = approx_sun_transit_time(alpha[JDSign.JD_ZERO], spa.longitude, nu);
        h0 = sun_hour_angle_at_rise_set(spa.latitude, delta[JDSign.JD_ZERO], h0_prime);
        if (h0 >= 0) {
          approx_sun_rise_and_set(m_rts, h0);
          for (var i = 0; i < SunState.SUN_COUNT; i++) {
            nu_rts[i] = nu + 360.985647 * m_rts[i];
            n = m_rts[i] + spa.delta_t / 86400;
            alpha_prime[i] = rts_alpha_delta_prime(alpha, n);
            delta_prime[i] = rts_alpha_delta_prime(delta, n);
            h_prime[i] = limit_degrees180pm(nu_rts[i] + spa.longitude - alpha_prime[i]);
            h_rts[i] = rts_sun_altitude(spa.latitude, delta_prime[i], h_prime[i]);
          }
          spa.srha = h_prime[SunState.SUN_RISE];
          spa.ssha = h_prime[SunState.SUN_SET];
          spa.sta = h_rts[SunState.SUN_TRANSIT];
          spa.suntransit = dayfrac_to_local_hr(m_rts[SunState.SUN_TRANSIT] - h_prime[SunState.SUN_TRANSIT] / 360, spa.timezone);
          spa.sunrise = dayfrac_to_local_hr(sun_rise_and_set(m_rts, h_rts, delta_prime, spa.latitude, h_prime, h0_prime, SunState.SUN_RISE), spa.timezone);
          spa.sunset = dayfrac_to_local_hr(sun_rise_and_set(m_rts, h_rts, delta_prime, spa.latitude, h_prime, h0_prime, SunState.SUN_SET), spa.timezone);
        } else
          spa.srha = spa.ssha = spa.sta = spa.suntransit = spa.sunrise = spa.sunset = -99999;
      }
      function calculate_geocentric_sun_right_ascension_and_declination(spa) {
        spa.jc = julian_century(spa.jd);
        spa.jde = julian_ephemeris_day(spa.jd, spa.delta_t);
        spa.jce = julian_ephemeris_century(spa.jde);
        spa.jme = julian_ephemeris_millennium(spa.jce);
        spa.l = earth_heliocentric_longitude(spa.jme);
        spa.b = earth_heliocentric_latitude(spa.jme);
        spa.r = earth_radius_vector(spa.jme);
        spa.theta = geocentric_longitude(spa.l);
        spa.beta = geocentric_latitude(spa.b);
        var x = [];
        x[TermsX.TERM_X0] = spa.x0 = mean_elongation_moon_sun(spa.jce);
        x[TermsX.TERM_X1] = spa.x1 = mean_anomaly_sun(spa.jce);
        x[TermsX.TERM_X2] = spa.x2 = mean_anomaly_moon(spa.jce);
        x[TermsX.TERM_X3] = spa.x3 = argument_latitude_moon(spa.jce);
        x[TermsX.TERM_X4] = spa.x4 = ascending_longitude_moon(spa.jce);
        nutation_longitude_and_obliquity(spa.jce, x, spa);
        spa.epsilon0 = ecliptic_mean_obliquity(spa.jme);
        spa.epsilon = ecliptic_true_obliquity(spa.del_epsilon, spa.epsilon0);
        spa.del_tau = aberration_correction(spa.r);
        spa.lamda = apparent_sun_longitude(spa.theta, spa.del_psi, spa.del_tau);
        spa.nu0 = greenwich_mean_sidereal_time(spa.jd, spa.jc);
        spa.nu = greenwich_sidereal_time(spa.nu0, spa.del_psi, spa.epsilon);
        spa.alpha = geocentric_right_ascension(spa.lamda, spa.epsilon, spa.beta);
        spa.delta = geocentric_declination(spa.beta, spa.epsilon, spa.lamda);
      }
      function spa_calculate(spa) {
        var result = validate_inputs(spa);
        if (result == 0) {
          spa.jd = julian_day(spa.year, spa.month, spa.day, spa.hour, spa.minute, spa.second, spa.delta_ut1, spa.timezone);
          calculate_geocentric_sun_right_ascension_and_declination(spa);
          spa.h = observer_hour_angle(spa.nu, spa.longitude, spa.alpha);
          spa.xi = sun_equatorial_horizontal_parallax(spa.r);
          var dltap = { delta_alpha: spa.del_alpha, delta_prime: spa.delta_prime };
          right_ascension_parallax_and_topocentric_dec(spa.latitude, spa.elevation, spa.xi, spa.h, spa.delta, dltap);
          spa.del_alpha = dltap.delta_alpha;
          spa.delta_prime = dltap.delta_prime;
          spa.alpha_prime = topocentric_right_ascension(spa.alpha, spa.del_alpha);
          spa.h_prime = topocentric_local_hour_angle(spa.h, spa.del_alpha);
          spa.e0 = topocentric_elevation_angle(spa.latitude, spa.delta_prime, spa.h_prime);
          spa.del_e = atmospheric_refraction_correction(spa.pressure, spa.temperature, spa.atmos_refract, spa.e0);
          spa.e = topocentric_elevation_angle_corrected(spa.e0, spa.del_e);
          spa.zenith = topocentric_zenith_angle(spa.e);
          spa.azimuth_astro = topocentric_azimuth_angle_astro(spa.h_prime, spa.latitude, spa.delta_prime);
          spa.azimuth = topocentric_azimuth_angle(spa.azimuth_astro);
          if (spa.function == exports.SPA_ZA_INC || spa.function == exports.SPA_ALL)
            spa.incidence = surface_incidence_angle(spa.zenith, spa.azimuth_astro, spa.azm_rotation, spa.slope);
          if (spa.function == exports.SPA_ZA_RTS || spa.function == exports.SPA_ALL)
            calculate_eot_and_sun_rise_transit_set(spa);
        }
        return result;
      }
      exports.spa_calculate = spa_calculate;
    }
  });
  return require_spa();
})();
