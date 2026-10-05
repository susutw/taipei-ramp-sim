[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](25.05736,121.58176,25.0712,121.6054);
  way["building"](25.05736,121.58176,25.0712,121.6054);
);
out body geom;
