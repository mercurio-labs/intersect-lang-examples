package CisternAnalysis {
    private import ISQ::*;
    private import SI::*;

    part def Tank;
    part garden : Tank;
    part reserve : Tank;

    analysis def FillSizing {
        subject tank : Tank;
        in attribute initial : VolumeValue = 1 [L];
        in attribute capacity : VolumeValue = 6 [L];
        in attribute fillTime : DurationValue;
        return 'flow' : VolumeFlowRateValue;
        assert constraint { capacity == initial + 'flow' * fillTime }
    }
    analysis sizeInlet : FillSizing {
        subject :>> tank = garden;
    }
    analysis sizeSlow : FillSizing {
        subject :>> tank = reserve;
    }

    analysis def EmbeddedSizing {
        subject tank : Tank;
        in attribute initial : VolumeValue = 1 [L];
        in attribute capacity : VolumeValue = 6 [L];
        in attribute duration : DurationValue = 4 [s];
        return 'flow' : VolumeFlowRateValue;
        rep language "urn:intersect:cistern:1" /*
cistern Garden {
  starts with 0 L
  holds 0 L
  inlet flows at 2 L/s
  when full, close inlet
  size sizeInlet to fill in 1 s
}
        */
    }
    analysis sizeEmbedded : EmbeddedSizing {
        subject :>> tank = garden;
    }
}
