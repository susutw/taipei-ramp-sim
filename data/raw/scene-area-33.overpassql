[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.06752,121.53218,25.07808,121.54775);
  way["building"](25.06752,121.53218,25.07808,121.54775);
);
out body geom;
